import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";

import { loadOntologyModel } from "./model.mjs";
import { parseTypeQLSchemaStructure } from "../shared/schema_structure.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const SEMANTIC_ROLE_OVERRIDES = new Map([
  [
    "https://w3id.org/semanticarts/ns/ontology/gist/isProducedBy",
    { subject: "product", object: "producer" }
  ]
]);

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readJson(relPath) {
  return JSON.parse(await fs.readFile(path.join(root, relPath), "utf8"));
}

async function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function iriLocalName(iri) {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf("/");
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

const RESERVED_IDENTIFIERS = new Set([
  "and",
  "attribute",
  "define",
  "entity",
  "fetch",
  "function",
  "group",
  "has",
  "insert",
  "isa",
  "is",
  "label",
  "links",
  "match",
  "not",
  "offset",
  "or",
  "owns",
  "plays",
  "reduce",
  "relation",
  "relates",
  "rule",
  "select",
  "sort",
  "sub",
  "thing",
  "type",
  "value"
]);

function safeIdentifier(name, suffix) {
  return RESERVED_IDENTIFIERS.has(name) ? `${name}${suffix}` : name;
}

function roleNamesForProperty(propertyIri, relationName) {
  const override = SEMANTIC_ROLE_OVERRIDES.get(propertyIri);
  if (override) return override;
  return {
    subject: `${relationName}Subject`,
    object: `${relationName}Object`
  };
}

function buildIdentifierMaps(model) {
  const relationNames = new Map();
  const attributeNames = new Map();

  for (const prop of model.resources.objectProperties) {
    relationNames.set(prop.iri, safeIdentifier(iriLocalName(prop.iri), "Rel"));
  }
  for (const prop of model.resources.datatypeProperties) {
    attributeNames.set(prop.iri, safeIdentifier(iriLocalName(prop.iri), "Attr"));
  }

  return {
    relation(iri) {
      return relationNames.get(iri) ?? safeIdentifier(iriLocalName(iri), "Rel");
    },
    attribute(iri) {
      return attributeNames.get(iri) ?? safeIdentifier(iriLocalName(iri), "Attr");
    }
  };
}

function namedSubPropertyEdges(properties) {
  const propertyIris = new Set(properties.map((property) => property.iri));
  return properties.flatMap((property) =>
    property.subPropertyOf
      .filter((term) => term.termType === "NamedNode" && propertyIris.has(term.value))
      .map((term) => ({ subtype: property.iri, supertype: term.value }))
  );
}

function edgeKey(subtype, supertype) {
  return `${subtype}::${supertype}`;
}

function assertAllEdgesPresent(actualEdges, expectedEdges, label) {
  const actual = new Set(actualEdges.map((edge) => edgeKey(edge.subtype, edge.supertype)));
  const missing = expectedEdges
    .map((edge) => edgeKey(edge.subtype, edge.supertype))
    .filter((key) => !actual.has(key));
  if (missing.length) {
    throw new Error(`missing ${label} structural edges: ${missing.join(", ")}`);
  }
}

function countGeneratedDocSubtypeEdges(docsText) {
  const relationPattern = /\(subtypeResource:\s+\$struct_left,\s+supertypeResource:\s+\$struct_right\)\s+isa\s+schemaSubTypeOf/g;
  return Array.from(docsText.matchAll(relationPattern)).length / 2;
}

function generatedDocsContainSubtypeEdge(docsText, edge) {
  const escapedSubtype = edge.subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedSupertype = edge.supertype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\$struct_left isa SchemaResource, has typeLabel "${escapedSubtype}";\\s+` +
    `\\$struct_right isa SchemaResource, has typeLabel "${escapedSupertype}";\\s+` +
    `not \\{\\s+` +
    `\\(subtypeResource: \\$struct_left, supertypeResource: \\$struct_right\\) isa schemaSubTypeOf;\\s+` +
    `\\};\\s+insert\\s+` +
    `\\(subtypeResource: \\$struct_left, supertypeResource: \\$struct_right\\) isa schemaSubTypeOf;`,
    "m"
  );
  return pattern.test(docsText);
}

async function assertHierarchyCoverage({ model, schemaText, docsText, translationReport }) {
  const identifiers = buildIdentifierMaps(model);
  const structure = parseTypeQLSchemaStructure([schemaText]);

  const datatypeEdges = namedSubPropertyEdges(model.resources.datatypeProperties).map((edge) => ({
    subtype: identifiers.attribute(edge.subtype),
    supertype: identifiers.attribute(edge.supertype),
  }));
  const objectEdges = namedSubPropertyEdges(model.resources.objectProperties).map((edge) => ({
    subtype: identifiers.relation(edge.subtype),
    supertype: identifiers.relation(edge.supertype),
  }));
  const roleEdges = namedSubPropertyEdges(model.resources.objectProperties).flatMap((edge) => {
    const subtype = identifiers.relation(edge.subtype);
    const supertype = identifiers.relation(edge.supertype);
    const subtypeRoles = roleNamesForProperty(edge.subtype, subtype);
    const supertypeRoles = roleNamesForProperty(edge.supertype, supertype);
    return [
      { subtype: `${subtype}:${subtypeRoles.subject}`, supertype: `${supertype}:${supertypeRoles.subject}` },
      { subtype: `${subtype}:${subtypeRoles.object}`, supertype: `${supertype}:${supertypeRoles.object}` },
    ];
  });

  assertAllEdgesPresent(structure.subtypeEdges, datatypeEdges, "datatype property");
  assertAllEdgesPresent(structure.subtypeEdges, objectEdges, "object property");
  assertAllEdgesPresent(structure.subtypeEdges, roleEdges, "role specialization");

  const hierarchy = translationReport.coverage?.propertyHierarchy;
  await assertCondition(
    hierarchy?.datatypeSubPropertyEdgesDiscovered === datatypeEdges.length &&
      hierarchy?.datatypeSubPropertyEdgesEmitted === datatypeEdges.length,
    "translation report datatype hierarchy counts do not match generated schema"
  );
  await assertCondition(
    hierarchy?.objectSubPropertyEdgesDiscovered === objectEdges.length &&
      hierarchy?.objectSubPropertyEdgesEmitted === objectEdges.length,
    "translation report object hierarchy counts do not match generated schema"
  );
  await assertCondition(
    hierarchy?.roleSpecializationsEmitted === roleEdges.length,
    "translation report role specialization count does not match generated schema"
  );

  const expectedSubtypeEdges = datatypeEdges.length + objectEdges.length + roleEdges.length;
  await assertCondition(
    countGeneratedDocSubtypeEdges(docsText) >= expectedSubtypeEdges,
    `generated schema docs contain fewer schemaSubTypeOf edges than required hierarchy coverage (${expectedSubtypeEdges})`
  );

  for (const edge of [...datatypeEdges, ...objectEdges, ...roleEdges]) {
    await assertCondition(
      generatedDocsContainSubtypeEdge(docsText, edge),
      `generated schema docs are missing schemaSubTypeOf metadata for ${edge.subtype} -> ${edge.supertype}`
    );
  }
}

async function assertChecksum(relPath, expected) {
  const actual = sha256(await fs.readFile(path.join(root, relPath)));
  await assertCondition(actual === expected, `checksum mismatch for ${relPath}`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

async function writeMergedQueryFile(keyword, relPaths, outPath) {
  const chunks = [];
  for (const relPath of relPaths) {
    let text = await fs.readFile(path.join(root, relPath), "utf8");
    text = text.replace(/^#.*\n/gm, "");
    text = text.replace(new RegExp(`^\\s*${keyword}\\s*\\n`, "i"), "");
    text = text.trim();
    if (text) chunks.push(text);
  }

  const hasPut = chunks.some((chunk) => /^put /m.test(chunk));
  const merged = hasPut
    ? `${chunks.join("\n\n")}\n`
    : `${keyword}\n\n${chunks.join("\n\n")}\n`;
  await fs.writeFile(outPath, merged, "utf8");
}

// ── Put-statement batching ─────────────────────────────────────────

const BATCH_SIZE = 10;

function splitPutStatements(text) {
  const stmts = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#") || t === "") continue;
    if ((t.startsWith("put ") || t.startsWith("match")) && cur) { stmts.push(cur.trim()); cur = line; }
    else { cur += (cur ? "\n" : "") + line; }
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

function groupPutStatements(stmts) {
  const groups = [];
  let g = null;
  for (const s of stmts) {
    const m = s.match(/^put\s+\$(\w+)\s+isa\s+(\w+)/);
    if (m) { if (g) groups.push(g); g = { variable: m[1], statements: [s] }; }
    else if (g && s.includes(`$${g.variable}`)) { g.statements.push(s); }
    else { if (g) groups.push(g); g = { variable: null, statements: [s] }; }
  }
  if (g) groups.push(g);
  return groups;
}

function findPreambles(allGroups) {
  const defs = new Map();
  for (const g of allGroups) if (g.variable) defs.set(g.variable, g);
  const needed = new Set();
  for (const g of allGroups) {
    for (const m of g.statements.join("\n").matchAll(/\$(\w+)/g)) {
      if (m[1] !== g.variable && defs.has(m[1])) needed.add(m[1]);
    }
  }
  return allGroups.filter((g) => g.variable && needed.has(g.variable));
}

function extractNamedQueries(text) {
  const blocks = new Map();
  let currentName = null;
  let currentLines = [];

  for (const line of text.split("\n")) {
    if (line.startsWith("# name: ")) {
      if (currentName) {
        blocks.set(
          currentName,
          currentLines.filter((item) => !item.startsWith("#")).join("\n").trim()
        );
      }
      currentName = line.slice("# name: ".length).trim();
      currentLines = [];
      continue;
    }
    if (currentName) currentLines.push(line);
  }

  if (currentName) {
    blocks.set(
      currentName,
      currentLines.filter((item) => !item.startsWith("#")).join("\n").trim()
    );
  }

  return blocks;
}

async function startTypedbServer(tempRoot) {
  const typedb = process.env.TYPEDB_BIN ?? path.join(process.env.HOME ?? "", ".typedb", "typedb");
  await fs.access(typedb);

  const grpcPort = await getFreePort();
  const httpPort = await getFreePort();
  const args = [
    "server",
    "--server.address",
    `127.0.0.1:${grpcPort}`,
    "--server.http.address",
    `127.0.0.1:${httpPort}`,
    "--storage.data-directory",
    path.join(tempRoot, "data"),
    "--logging.directory",
    path.join(tempRoot, "logs"),
    "--diagnostics.reporting.metrics",
    "false",
    "--diagnostics.reporting.errors",
    "false",
    "--diagnostics.monitoring.enabled",
    "false"
  ];

  const child = spawn(typedb, args, { cwd: tempRoot, stdio: ["ignore", "pipe", "pipe"] });

  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`TypeDB server did not become ready.\n${output}`));
    }, 15000);

    function onData(chunk) {
      output += chunk.toString();
      if (output.includes("Ready!")) {
        clearTimeout(timeout);
        resolve();
      }
    }

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`TypeDB server exited early with code ${code}.\n${output}`));
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  return { child, grpcPort };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function main() {
  const pkg = await readJson("package.json");
  const mp = `manifests/gist-v${pkg.version}`;
  const upstreamDir = `upstream/gist/${pkg.upstream.tag}`;
  const manifest = await readJson(`${mp}.translation-manifest.json`);
  const sourceInventory = await readJson(`${upstreamDir}/source-artifacts.json`);
  const translationReport = await readJson(`${mp}.translation-report.json`);
  const axiomIndex = await readJson(`${mp}.axiom-queries.json`);
  const axiomLibrary = await fs.readFile(path.join(root, "queries/gistCore-axioms.tql"), "utf8");

  for (const relPath of pkg.assembly.loadOrder) {
    await fs.access(path.join(root, relPath));
  }

  for (const artifact of manifest.upstream.sourceArtifacts) {
    await assertChecksum(artifact.path, artifact.sha256);
  }

  for (const artifact of manifest.artifacts) {
    await assertChecksum(artifact.path, artifact.sha256);
  }

  for (const file of sourceInventory.files) {
    await fs.access(path.join(root, upstreamDir, file.path));
  }

  const activeTqlFiles = [...pkg.schemas.map((schema) => schema.file), ...pkg.data, ...(pkg.queries ?? [])];
  for (const relPath of activeTqlFiles) {
    const text = await fs.readFile(path.join(root, relPath), "utf8");
    await assertCondition(text.includes(`# manifest: ${mp}.translation-manifest.json`), `missing manifest header in ${relPath}`);
    await assertCondition(text.includes("# upstream-commit: 6ab80c158a7fa56a1b5d3d824b125b92107e8f08"), `missing upstream commit header in ${relPath}`);
  }

  const docsText = await fs.readFile(path.join(root, "data/gistCore-schema-docs.tql"), "utf8");
  await assertCondition(docsText.includes("isa SchemaModule"), "SchemaModule seed missing");
  await assertCondition(docsText.includes("isa SchemaResource"), "SchemaResource seed missing");
  await assertCondition(docsText.includes("isa inModule"), "inModule seed missing");

  const model = await loadOntologyModel(root);
  const schemaText = await fs.readFile(path.join(root, "schema/gistCore.tql"), "utf8");
  await assertHierarchyCoverage({ model, schemaText, docsText, translationReport });

  const tmp1 = path.join(os.tmpdir(), `gist-ir-summary-1-${process.pid}.json`);
  const tmp2 = path.join(os.tmpdir(), `gist-ir-summary-2-${process.pid}.json`);
  const run1 = spawnSync("node", ["tools/gist_to_typeql/parse_gist.mjs", "--out", tmp1], { cwd: root, encoding: "utf8" });
  const run2 = spawnSync("node", ["tools/gist_to_typeql/parse_gist.mjs", "--out", tmp2], { cwd: root, encoding: "utf8" });
  await assertCondition(run1.status === 0, `parse run 1 failed: ${run1.stderr}`);
  await assertCondition(run2.status === 0, `parse run 2 failed: ${run2.stderr}`);

  const first = await fs.readFile(tmp1);
  const second = await fs.readFile(tmp2);
  await assertCondition(first.equals(second), "IR parser output is not deterministic");

  const checkedIn = await fs.readFile(path.join(root, `${mp}.ir-summary.json`));
  await assertCondition(first.equals(checkedIn), "checked-in IR summary is stale; run npm run parse:ir");

  const emitDir1 = await fs.mkdtemp(path.join(os.tmpdir(), "gist-emit-1-"));
  const emitDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "gist-emit-2-"));
  const emit = spawnSync("node", ["tools/gist_to_typeql/emit_structural.mjs", "--out-dir", emitDir1], { cwd: root, encoding: "utf8" });
  await assertCondition(emit.status === 0, `structural emitter failed: ${emit.stderr}`);
  const emit2 = spawnSync("node", ["tools/gist_to_typeql/emit_structural.mjs", "--out-dir", emitDir2], { cwd: root, encoding: "utf8" });
  await assertCondition(emit2.status === 0, `structural emitter second run failed: ${emit2.stderr}`);
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, "schema/gistCore.tql"))) === sha256(await fs.readFile(path.join(emitDir2, "schema/gistCore.tql"))),
    "generated schema is not deterministic"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, "data/gistCore-domain-seeds.tql"))) ===
      sha256(await fs.readFile(path.join(emitDir2, "data/gistCore-domain-seeds.tql"))),
    "generated domain seeds are not deterministic"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, `${mp}.translation-report.json`))) ===
      sha256(await fs.readFile(path.join(emitDir2, `${mp}.translation-report.json`))),
    "generated translation report is not deterministic"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, "queries/gistCore-axioms.tql"))) ===
      sha256(await fs.readFile(path.join(emitDir2, "queries/gistCore-axioms.tql"))),
    "generated axiom query library is not deterministic"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, `${mp}.axiom-queries.json`))) ===
      sha256(await fs.readFile(path.join(emitDir2, `${mp}.axiom-queries.json`))),
    "generated axiom query index is not deterministic"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, "schema/gistCore.tql"))) === sha256(await fs.readFile(path.join(root, "schema/gistCore.tql"))),
    "checked-in schema is stale; run npm run emit:structural"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, "data/gistCore-domain-seeds.tql"))) ===
      sha256(await fs.readFile(path.join(root, "data/gistCore-domain-seeds.tql"))),
    "checked-in domain seeds are stale; run npm run emit:structural"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, `${mp}.translation-report.json`))) ===
      sha256(await fs.readFile(path.join(root, `${mp}.translation-report.json`))),
    "checked-in translation report is stale; run npm run emit:structural"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, "queries/gistCore-axioms.tql"))) ===
      sha256(await fs.readFile(path.join(root, "queries/gistCore-axioms.tql"))),
    "checked-in axiom query library is stale; run npm run emit:structural"
  );
  await assertCondition(
    sha256(await fs.readFile(path.join(emitDir1, `${mp}.axiom-queries.json`))) ===
      sha256(await fs.readFile(path.join(root, `${mp}.axiom-queries.json`))),
    "checked-in axiom query index is stale; run npm run emit:structural"
  );
  await assertCondition(
    translationReport.coverage?.queryableProvenanceSeedDataPending === false,
    "translation report must confirm that queryable provenance seed data is emitted"
  );
  await assertCondition(
    Array.isArray(translationReport.coverage?.equivalentClassAxiomsPending),
    "translation report must enumerate unresolved equivalent-class coverage"
  );
  await assertCondition(
    Array.isArray(translationReport.coverage?.axiomQueryCoverage?.classesCovered),
    "translation report must enumerate generated axiom-query coverage"
  );
  await assertCondition(
    Array.isArray(translationReport.coverage?.axiomQueryCoverage?.approximations) &&
      translationReport.coverage.axiomQueryCoverage.approximations.length === 0,
    "translation report must not report remaining axiom-query approximations"
  );
  await assertCondition(Array.isArray(axiomIndex.queries) && axiomIndex.queries.length > 0, "axiom-query index must contain generated query definitions");
  await assertCondition(
    axiomIndex.queries.some((item) => item.name === "axiom::ContingentEvent::satisfies"),
    "axiom-query index must contain representative ContingentEvent coverage"
  );
  await assertCondition(!axiomLibrary.includes("# warning:"), "axiom query library must not contain approximation warnings");

  const typedbTemp = await fs.mkdtemp(path.join(os.tmpdir(), "gist-typedb-validate-"));
  const mergedSchema = path.join(typedbTemp, "merged-schema.tql");
  await writeMergedQueryFile("define", pkg.schemas.map((schema) => schema.file), mergedSchema);

  const dbName = `gist_validate_${process.pid}`;
  const typedbBin = process.env.TYPEDB_BIN ?? path.join(process.env.HOME ?? "", ".typedb", "typedb");

  function runConsoleScript(grpcPort, script) {
    const scriptFile = path.join(typedbTemp, `script-${Date.now()}.tql`);
    spawnSync("bash", ["-c", `cat > ${scriptFile}`], { input: script, encoding: "utf8" });
    return spawnSync(typedbBin, [
      "console", `--address=127.0.0.1:${grpcPort}`,
      "--username=admin", "--password=password", "--tls-disabled",
      "--script", scriptFile
    ], { cwd: root, encoding: "utf8" });
  }

  let typedbServer;
  try {
    typedbServer = await startTypedbServer(typedbTemp);
    const { grpcPort } = typedbServer;

    // Create database and load schema
    const schemaResult = runConsoleScript(grpcPort,
      `database create ${dbName}\n\ntransaction schema ${dbName}\n\nsource ${mergedSchema}\n\ncommit\n\nexit\n`
    );
    await assertCondition(schemaResult.status === 0, `TypeDB schema load failed:\n${schemaResult.stdout}\n${schemaResult.stderr}`);

    // Load write assets exactly as the package publishes them.
    for (const relativePath of pkg.data) {
      const assetPath = path.join(root, relativePath);
      const dataResult = runConsoleScript(grpcPort,
        `transaction write ${dbName}\n\nsource ${assetPath}\n\ncommit\n\nexit\n`
      );
      await assertCondition(
        dataResult.status === 0,
        `TypeDB write asset load failed (${relativePath}):\n${dataResult.stdout}\n${dataResult.stderr}`
      );
    }

    const queryScriptPath = path.join(typedbTemp, "query-script.tql");
    await fs.writeFile(
      queryScriptPath,
      [
        `transaction read gist_validate_${process.pid}`,
        "",
        'match',
        '$schemaModule isa SchemaModule, has moduleKey "gist-core";',
        'limit 1;',
        "",
        'match',
        '$r isa SchemaResource, has typeLabel "Event";',
        'limit 1;',
        "",
        'match',
        '$mt isa MediaType, has uniqueText "application/json";',
        'limit 1;',
        "",
        'match',
        '$module isa OntologyModule, has moduleRepoUrl "https://github.com/semanticarts/gist";',
        `$v isa OntologyModuleVersion, has moduleVersion "${pkg.version}", has upstreamCommit "6ab80c158a7fa56a1b5d3d824b125b92107e8f08";`,
        '(version: $v, module: $module) isa ontologyModuleVersionOf;',
        '$ga isa GeneratedArtifactRecord, has artifactPath "schema/gistCore.tql";',
        '(generatedArtifact: $ga, version: $v) isa generatedArtifactForOntologyModuleVersion;',
        'limit 1;',
        "",
        'close',
        "",
        'exit',
        ""
      ].join("\n"),
      "utf8"
    );
    const query = spawnSync(
      typedbBin,
      [
        "console",
        `--address=127.0.0.1:${typedbServer.grpcPort}`,
        "--username=admin",
        "--password=password",
        "--tls-disabled",
        "--script",
        queryScriptPath
      ],
      { cwd: root, encoding: "utf8" }
    );
    await assertCondition(query.status === 0, `TypeDB query smoke test failed:\n${query.stdout}\n${query.stderr}`);
    await assertCondition(
        query.stdout.includes("$schemaModule") &&
        query.stdout.includes("SchemaModule") &&
        query.stdout.includes("$r") &&
        query.stdout.includes("SchemaResource") &&
        query.stdout.includes("$mt") &&
        query.stdout.includes("MediaType") &&
        query.stdout.includes("$module") &&
        query.stdout.includes("OntologyModule") &&
        query.stdout.includes("$v") &&
        query.stdout.includes("OntologyModuleVersion") &&
        query.stdout.includes("$ga") &&
        query.stdout.includes("GeneratedArtifactRecord") &&
        query.stdout.includes("Finished. Total answers: 1"),
      `TypeDB query smoke test returned unexpected answer counts:\n${query.stdout}`
    );

    const namedQueries = extractNamedQueries(axiomLibrary);
    const representativeQueries = [
      "axiom::Agreement::satisfies",
      "axiom::ContemporaryEvent::satisfies",
      "axiom::IntergovernmentalOrganization::satisfies",
      "axiom::OrderedMember::satisfies"
    ];
    for (const queryName of representativeQueries) {
      await assertCondition(namedQueries.has(queryName), `missing representative axiom query ${queryName}`);
    }
    const axiomQueryScriptPath = path.join(typedbTemp, "axiom-query-script.tql");
    await fs.writeFile(
      axiomQueryScriptPath,
      [
        `transaction read gist_validate_${process.pid}`,
        "",
        ...representativeQueries.flatMap((queryName) => [namedQueries.get(queryName), ""]),
        "close",
        "",
        "exit",
        ""
      ].join("\n"),
      "utf8"
    );
    const axiomQueryRun = spawnSync(
      typedbBin,
      [
        "console",
        `--address=127.0.0.1:${typedbServer.grpcPort}`,
        "--username=admin",
        "--password=password",
        "--tls-disabled",
        "--script",
        axiomQueryScriptPath
      ],
      { cwd: root, encoding: "utf8" }
    );
    await assertCondition(
      axiomQueryRun.status === 0,
      `Representative axiom queries failed to compile or run:\n${axiomQueryRun.stdout}\n${axiomQueryRun.stderr}`
    );
    await assertCondition(
      (axiomQueryRun.stdout.match(/Finished\. Total answers:/g) ?? []).length >= representativeQueries.length,
      `Representative axiom query run did not execute every selected query:\n${axiomQueryRun.stdout}`
    );
  } finally {
    await stopProcess(typedbServer?.child);
  }

  console.log("bootstrap validation ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
