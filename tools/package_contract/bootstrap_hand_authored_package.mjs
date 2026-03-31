import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gistRoot = path.resolve(__dirname, "../..");

const GENERATOR = {
  name: "hand-authored-package-bootstrap",
  version: "0.1.0",
};

const MANIFEST_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://vibe-machine.github.io/ontology-gist/manifests/package-manifest.schema.json",
  title: "Ontology Package Manifest",
  type: "object",
  required: ["manifestVersion", "package", "upstream", "generator", "artifacts"],
  properties: {
    manifestVersion: { type: "string" },
    package: {
      type: "object",
      required: ["name", "version"],
      properties: {
        name: { type: "string" },
        version: { type: "string" },
      },
      additionalProperties: false,
    },
    upstream: {
      type: "object",
      required: ["repoUrl", "tag", "commit", "sourceArtifacts"],
      properties: {
        repoUrl: { type: "string" },
        tag: { type: "string" },
        commit: { type: "string" },
        sourceArtifacts: {
          type: "array",
          items: {
            type: "object",
            required: ["path", "sha256"],
            properties: {
              path: { type: "string" },
              sha256: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    generator: {
      type: "object",
      required: ["name", "version", "generatedAt"],
      properties: {
        name: { type: "string" },
        version: { type: "string" },
        generatedAt: { type: "string" },
      },
      additionalProperties: false,
    },
    artifacts: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "path", "sha256"],
        properties: {
          kind: { type: "string" },
          path: { type: "string" },
          sha256: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

function escapeTypeQL(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readSchemaBody(content) {
  const defineIndex = content.indexOf("define");
  if (defineIndex === -1) {
    throw new Error("shared schema file missing define block");
  }
  return content.slice(defineIndex).trim();
}

function tqlString(value) {
  return JSON.stringify(value);
}

function renderHeader({ repoUrl, tag, commit, sourceArtifacts, manifestPath, generator }) {
  return [
    "# Provenance bootstrap",
    `# upstream-repo: ${repoUrl}`,
    `# upstream-tag: ${tag}`,
    `# upstream-commit: ${commit}`,
    "# source-artifacts:",
    ...sourceArtifacts.map((artifact) => `# - ${artifact.path}`),
    `# manifest: ${manifestPath}`,
    `# generator: ${generator.name}/${generator.version}`,
    "",
  ].join("\n");
}

function extractTypeDocEntries(content) {
  const entries = [];
  const lines = content.split("\n");
  const blocks = [];
  let currentBlock = null;

  for (const line of lines) {
    if (/^\$[A-Za-z0-9_]+\s+isa\s+TypeDoc,/.test(line.trim())) {
      currentBlock = [line];
      continue;
    }
    if (currentBlock) {
      currentBlock.push(line);
      if (line.trim().endsWith('";')) {
        blocks.push(currentBlock.join("\n"));
        currentBlock = null;
      }
    }
  }

  for (const block of blocks) {
    const fields = {};
    const fieldRegex = /has\s+([A-Za-z0-9_]+)\s+"([^"]*)"/g;
    let fieldMatch;
    while ((fieldMatch = fieldRegex.exec(block)) !== null) {
      fields[fieldMatch[1]] = fieldMatch[2];
    }
    if (fields.typeLabel) {
      entries.push(fields);
    }
  }
  return entries;
}

async function readWorkingTreeOrHead(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (await fileExists(absolutePath)) {
    return fs.readFile(absolutePath, "utf8");
  }
  return execFileSync("git", ["show", `HEAD:${relativePath}`], { cwd: repoRoot, encoding: "utf8" });
}

function pathExistsInHead(repoRoot, relativePath) {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${relativePath}`], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function stripToKeyword(text, keyword) {
  const keywords = Array.isArray(keyword) ? keyword : [keyword];
  for (const kw of keywords) {
    // Match keyword followed by newline (standalone) or space (inline, e.g. "put $var")
    const pattern = new RegExp(`^${kw}(?=\\n| )`, "m");
    const match = pattern.exec(text);
    if (match) return text.slice(match.index);
  }
  throw new Error(`could not find ${keywords.join(" or ")} block`);
}

function renderSchemaDocs(meta, docEntries) {
  const lines = [renderHeader(meta), "", `put $module isa SchemaModule,`, `  has moduleKey "${escapeTypeQL(meta.packageName)}",`, `  has moduleName "${escapeTypeQL(meta.moduleName)}",`, `  has moduleKind "${escapeTypeQL(meta.moduleKind)}";`, ""];

  docEntries.forEach((entry, index) => {
    const resourceVar = `$r${index + 1}`;
    const docKey = `${meta.repoUrl}#${entry.typeLabel}`;
    const kind = entry.typeKind || "resource";
    lines.push(`put ${resourceVar} isa SchemaResource,`);
    lines.push(`  has docKey "${escapeTypeQL(docKey)}",`);
    lines.push(`  has iri "${escapeTypeQL(docKey)}",`);
    lines.push(`  has typeLabel "${escapeTypeQL(entry.typeLabel)}",`);
    lines.push(`  has kind "${escapeTypeQL(kind)}",`);
    lines.push(`  has prefLabel "${escapeTypeQL(entry.typeLabel)}",`);
    lines.push(`  has definition "${escapeTypeQL(entry.definition || "")}"${entry.usageNote ? "," : ";"} `);
    if (entry.usageNote) {
      lines.push(`  has scopeNote "${escapeTypeQL(entry.usageNote)}";`);
    }
    lines.push(`put (resource: ${resourceVar}, module: $module) isa inModule;`);
    lines.push("");
  });

  return lines.join("\n").replace(/; \n/g, ";\n");
}

function renderProvenanceData(manifest, manifestPath, provenancePath) {
  const moduleRepoUrl = manifest.upstream.repoUrl;
  const moduleVersionKey = `${moduleRepoUrl}@${manifest.package.version}`;
  const lines = [
    renderHeader({
      repoUrl: manifest.upstream.repoUrl,
      tag: manifest.upstream.tag,
      commit: manifest.upstream.commit,
      sourceArtifacts: manifest.upstream.sourceArtifacts,
      manifestPath,
      generator: manifest.generator,
    }),
    "",
    "put $module isa OntologyModule,",
    `  has moduleName "${escapeTypeQL(manifest.package.name)}",`,
    `  has moduleRepoUrl "${escapeTypeQL(moduleRepoUrl)}";`,
    "",
    "put $version isa OntologyModuleVersion,",
    `  has moduleVersionKey "${escapeTypeQL(moduleVersionKey)}",`,
    `  has moduleVersion "${escapeTypeQL(manifest.package.version)}",`,
    `  has upstreamCommit "${escapeTypeQL(manifest.upstream.commit)}",`,
    `  has manifestPath "${escapeTypeQL(manifestPath)}",`,
    `  has generatorName "${escapeTypeQL(manifest.generator.name)}",`,
    `  has generatorVersion "${escapeTypeQL(manifest.generator.version)}",`,
    `  has generatedAt "${escapeTypeQL(manifest.generator.generatedAt)}";`,
    "",
    "put (version: $version, module: $module) isa ontologyModuleVersionOf;",
    "",
  ];

  manifest.upstream.sourceArtifacts.forEach((artifact, index) => {
    const variable = `$s${index + 1}`;
    lines.push(`put ${variable} isa SourceArtifactRecord,`);
    lines.push(`  has sourcePath "${escapeTypeQL(artifact.path)}",`);
    lines.push(`  has sourceSha256 "${escapeTypeQL(artifact.sha256)}";`);
    lines.push(`put (version: $version, sourceArtifact: ${variable}) isa ontologyModuleVersionBasedOnSourceArtifact;`);
    lines.push("");
  });

  const generatedArtifacts = manifest.artifacts.filter((artifact) => artifact.path !== provenancePath);
  generatedArtifacts.forEach((artifact, index) => {
    const variable = `$g${index + 1}`;
    lines.push(`put ${variable} isa GeneratedArtifactRecord,`);
    lines.push(`  has artifactPath "${escapeTypeQL(artifact.path)}",`);
    lines.push(`  has artifactKind "${escapeTypeQL(artifact.kind)}",`);
    lines.push(`  has artifactSha256 "${escapeTypeQL(artifact.sha256)}";`);
    lines.push(`put (generatedArtifact: ${variable}, version: $version) isa generatedArtifactForOntologyModuleVersion;`);
    lines.push("");
  });

  return lines.join("\n").trimEnd() + "\n";
}

function renderDocsReadme({ packageName, displayName, manifestPath, docsPath, provenancePath, repoUrl }) {
  return `# Package Contract\n
This repository publishes the \`${displayName}\` ontology package using the self-describing documentation and provenance contract established by \`ontology-gist\`.

Current package boundaries:

- \`schema/\`: package schema plus the shared self-describing/provenance/administrative schemas
- \`data/\`: package seed data, queryable module-version provenance records, and schema documentation records
- \`manifests/\`: machine-readable package manifest for deterministic artifact tracking
- \`tools/package_contract/\`: bootstrap validation for this hand-authored package

Current status:

- \`${docsPath}\` is the authoritative documentation path for package-local schema resources.
- \`${provenancePath}\` records the ontology module version, source artifacts, and generated artifact checksums.
- \`${manifestPath}\` is the filesystem source of truth for the package contract.
- Legacy TypeDoc files are retired and are no longer part of active package assembly.

Design references:

- \`Design: TypeDB Schema Documentation & Provenance\`
  - https://www.notion.so/31bc633a07178161923fd6f322f0e5fb
- \`Design: Self-Describing Schema\`
  - https://www.notion.so/31cc633a07178180b139cb56c3c80268

Canonical contract reference:

- \`ontology-gist\`
  - ${repoUrl}

This package is hand-authored, so it does not vendor upstream ontology source files or ship OWL translation tooling. It still follows the same documentation/provenance contract so downstream loaders and tooling can treat ontology packages consistently.
`;
}

function renderValidatorScript() {
  return `import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

function hashText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
}

async function hashFile(relativePath) {
  const buffer = await fs.readFile(path.join(root, relativePath));
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const packageJson = await readJson("package.json");
  const manifestPath = packageJson.provenance?.manifest;
  assertCondition(Boolean(manifestPath), "package.json missing provenance.manifest");

  const manifest = await readJson(manifestPath);
  assertCondition(packageJson.name === manifest.package.name, "package name mismatch");
  assertCondition(packageJson.version === manifest.package.version, "package version mismatch");
  assertCondition(!("domains" in packageJson), "legacy domains field should be removed");
  assertCondition(!("categorization" in packageJson), "legacy categorization field should be removed");
  assertCondition(
    !(packageJson.dependencies || []).some((dependency) => dependency.name === "typedoc"),
    "typedoc dependency should be removed"
  );

  for (const artifact of manifest.upstream.sourceArtifacts) {
    const actual = await hashFile(artifact.path);
    assertCondition(actual === artifact.sha256, \`source artifact hash mismatch: \${artifact.path}\`);
  }

  for (const artifact of manifest.artifacts) {
    const actual = await hashFile(artifact.path);
    assertCondition(actual === artifact.sha256, \`generated artifact hash mismatch: \${artifact.path}\`);
  }

  const headerFiles = [
    "schema/self-describing-schema.tql",
    "schema/package-provenance.tql",
    "schema/administrative-operations.tql",
    ...manifest.artifacts.filter((artifact) => artifact.path.endsWith(".tql")).map((artifact) => artifact.path),
  ];

  const expectedHeader = \`# manifest: \${manifestPath}\`;
  for (const relativePath of new Set(headerFiles)) {
    const text = await fs.readFile(path.join(root, relativePath), "utf8");
    assertCondition(text.includes(expectedHeader), \`missing manifest header in \${relativePath}\`);
  }

  assertCondition(Array.isArray(packageJson.manifests) && packageJson.manifests.includes(manifestPath), "package.json manifests missing active manifest");
  assertCondition(await fs.stat(path.join(root, "docs/translation/README.md")).then(() => true).catch(() => false), "missing docs/translation/README.md");

  console.log("bootstrap validation ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
`;
}

async function writeText(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function bootstrap(repoRoot) {
  const packagePath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
  const infrastructureNames = ["self-describing-schema", "package-provenance", "administrative-operations"];
  const packageSchemas = (packageJson.schemas || []).filter((schema) => !infrastructureNames.includes(schema.name));
  if (packageSchemas.length === 0) {
    throw new Error(`could not determine main schema for ${repoRoot}`);
  }
  const mainSchema = packageSchemas[0];

  const legacyTypedoc =
    (packageJson.data || []).find((relativePath) => relativePath.endsWith("-typedoc.tql")) ||
    (packageJson.legacyDocumentation?.deprecatedFiles || []).find((relativePath) => relativePath.endsWith("-typedoc.tql"));
  const docsPath = `data/${packageJson.name}-schema-docs.tql`;
  const provenancePath = `data/${packageJson.name}-provenance.tql`;
  const manifestPath = `manifests/${packageJson.name}-v${packageJson.version}.package-manifest.json`;

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const sourceDataFiles = (packageJson.data || []).filter(
    (relativePath) =>
      relativePath !== legacyTypedoc &&
      !relativePath.endsWith("-provenance.tql") &&
      !relativePath.endsWith("-schema-docs.tql")
  );
  const sourceArtifacts = ["package.json", ...packageSchemas.map((s) => s.file), ...sourceDataFiles];

  const legacyFiles = [legacyTypedoc, "data/domains.tql", "data/categorize.tql"].filter(
    (relativePath) => Boolean(relativePath) && !sourceArtifacts.includes(relativePath)
  );

  const schemaBody = readSchemaBody(await fs.readFile(path.join(gistRoot, "schema/self-describing-schema.tql"), "utf8"));
  const provenanceSchemaBody = readSchemaBody(await fs.readFile(path.join(gistRoot, "schema/package-provenance.tql"), "utf8"));
  const administrativeSchemaBody = readSchemaBody(await fs.readFile(path.join(gistRoot, "schema/administrative-operations.tql"), "utf8"));
  const hasLegacyTypedoc = Boolean(legacyTypedoc) && (
    (await fileExists(path.join(repoRoot, legacyTypedoc))) ||
    pathExistsInHead(repoRoot, legacyTypedoc)
  );

  const baseMeta = {
    repoUrl: packageJson.source,
    tag: `v${packageJson.version}`,
    commit: currentCommit,
    sourceArtifacts: sourceArtifacts.map((artifactPath) => ({ path: artifactPath })),
    manifestPath,
    generator: GENERATOR,
    packageName: packageJson.name,
    moduleName: packageJson.displayName || packageJson.name,
    moduleKind: "hand-authored-package",
  };

  const packageJsonNext = {
    ...packageJson,
    scripts: {
      ...(packageJson.scripts || {}),
      "validate:bootstrap": "node tools/package_contract/validate_bootstrap.mjs",
    },
    schemas: [
      { name: "self-describing-schema", file: "schema/self-describing-schema.tql" },
      { name: "package-provenance", file: "schema/package-provenance.tql" },
      { name: "administrative-operations", file: "schema/administrative-operations.tql" },
      ...packageSchemas,
    ],
    data: [...sourceDataFiles, provenancePath, docsPath],
    manifests: [manifestPath],
    assembly: {
      loadOrder: [
        "schema/self-describing-schema.tql",
        "schema/package-provenance.tql",
        "schema/administrative-operations.tql",
        ...packageSchemas.map((s) => s.file),
        ...sourceDataFiles,
        provenancePath,
        docsPath
      ],
      generatedArtifacts: [
        "schema/self-describing-schema.tql",
        "schema/package-provenance.tql",
        "schema/administrative-operations.tql",
        docsPath,
        provenancePath,
        "manifests/package-manifest.schema.json",
        manifestPath,
      ],
    },
    provenance: {
      manifest: manifestPath,
      status: "bootstrap",
    },
    legacyDocumentation: {
      deprecatedFiles: legacyFiles,
      status: "superseded-by-schema-resource",
    },
    dependencies: (packageJson.dependencies || []).filter((dependency) => dependency.name !== "typedoc"),
  };
  delete packageJsonNext.domains;
  delete packageJsonNext.categorization;

  const packageJsonText = jsonText(packageJsonNext);
  const sourceArtifactHashes = [];
  for (const relativePath of sourceArtifacts) {
    if (relativePath === "package.json") {
      sourceArtifactHashes.push({ path: relativePath, sha256: sha256Text(packageJsonText) });
    } else {
      sourceArtifactHashes.push({ path: relativePath, sha256: await sha256File(path.join(repoRoot, relativePath)) });
    }
  }

  const headerMeta = {
    ...baseMeta,
    sourceArtifacts: sourceArtifactHashes,
  };

  const sharedSchemaText = `${renderHeader(headerMeta)}${schemaBody}\n`;
  const provenanceSchemaText = `${renderHeader(headerMeta)}${provenanceSchemaBody}\n`;
  const administrativeSchemaText = `${renderHeader(headerMeta)}${administrativeSchemaBody}\n`;
  const schemaDocsText = hasLegacyTypedoc
    ? renderSchemaDocs(headerMeta, extractTypeDocEntries(await readWorkingTreeOrHead(repoRoot, legacyTypedoc)))
    : `${renderHeader(headerMeta)}${stripToKeyword(await readWorkingTreeOrHead(repoRoot, docsPath), ["put", "insert"])}`;
  const manifestSchemaText = jsonText(MANIFEST_SCHEMA);
  const docsReadmeText = renderDocsReadme({
    packageName: packageJson.name,
    displayName: packageJson.displayName || packageJson.name,
    manifestPath,
    docsPath,
    provenancePath,
    repoUrl: packageJson.source,
  });

  const manifestWithoutProvenance = {
    $schema: "./package-manifest.schema.json",
    manifestVersion: "1.0.0",
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    upstream: {
      repoUrl: packageJson.source,
      tag: `v${packageJson.version}`,
      commit: currentCommit,
      sourceArtifacts: sourceArtifactHashes,
    },
    generator: {
      ...GENERATOR,
      generatedAt,
    },
    artifacts: [
      { kind: "meta-schema", path: "schema/self-describing-schema.tql", sha256: sha256Text(sharedSchemaText) },
      { kind: "provenance-schema", path: "schema/package-provenance.tql", sha256: sha256Text(provenanceSchemaText) },
      { kind: "administrative-schema", path: "schema/administrative-operations.tql", sha256: sha256Text(administrativeSchemaText) },
      { kind: "documentation", path: docsPath, sha256: sha256Text(schemaDocsText) },
      { kind: "manifest-schema", path: "manifests/package-manifest.schema.json", sha256: sha256Text(manifestSchemaText) },
    ],
  };

  const provenanceText = renderProvenanceData(manifestWithoutProvenance, manifestPath, provenancePath);
  const manifest = {
    ...manifestWithoutProvenance,
    artifacts: [
      ...manifestWithoutProvenance.artifacts,
      { kind: "provenance-seeds", path: provenancePath, sha256: sha256Text(provenanceText) },
    ],
  };
  const manifestText = jsonText(manifest);

  await writeText(repoRoot, "package.json", packageJsonText);
  await writeText(repoRoot, "schema/self-describing-schema.tql", sharedSchemaText);
  await writeText(repoRoot, "schema/package-provenance.tql", provenanceSchemaText);
  await writeText(repoRoot, "schema/administrative-operations.tql", administrativeSchemaText);
  await writeText(repoRoot, docsPath, schemaDocsText);
  await writeText(repoRoot, provenancePath, provenanceText);
  await writeText(repoRoot, "manifests/package-manifest.schema.json", manifestSchemaText);
  await writeText(repoRoot, manifestPath, manifestText);
  await writeText(repoRoot, "docs/translation/README.md", docsReadmeText);
  await writeText(repoRoot, "tools/package_contract/validate_bootstrap.mjs", renderValidatorScript());

  for (const legacyFile of legacyFiles) {
    const legacyPath = path.join(repoRoot, legacyFile);
    if (await fileExists(legacyPath)) {
      await fs.rm(legacyPath);
    }
  }

  console.log(`bootstrapped ${packageJson.name} at ${repoRoot}`);
}

const repoRoots = process.argv.slice(2);
if (repoRoots.length === 0) {
  console.error("usage: node tools/package_contract/bootstrap_hand_authored_package.mjs <repo> [repo...]");
  process.exit(1);
}

for (const repoRoot of repoRoots) {
  await bootstrap(path.resolve(repoRoot));
}
