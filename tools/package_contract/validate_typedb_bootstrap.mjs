import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");
const workspaceRoot = path.resolve(root, "..");

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(basePath, relativePath) {
  return JSON.parse(await fs.readFile(path.join(basePath, relativePath), "utf8"));
}

function packageRepoPath(name) {
  return path.join(workspaceRoot, `ontology-${name}`);
}

async function resolvePackageOrder(packageRoot, seen = new Set(), visiting = new Set()) {
  const manifest = await readJson(packageRoot, "package.json");
  const packageName = manifest.name;

  if (seen.has(packageName)) return [];
  if (visiting.has(packageName)) {
    throw new Error(`cyclic ontology dependency detected at ${packageName}`);
  }

  visiting.add(packageName);
  const ordered = [];
  for (const dependency of manifest.dependencies ?? []) {
    const dependencyRoot = packageRepoPath(dependency.name);
    await fs.access(path.join(dependencyRoot, "package.json"));
    ordered.push(...await resolvePackageOrder(dependencyRoot, seen, visiting));
  }
  visiting.delete(packageName);

  if (!seen.has(packageName)) {
    seen.add(packageName);
    ordered.push({ root: packageRoot, manifest });
  }
  return ordered;
}

function classifyAssemblyAssets(manifest) {
  const schemaAssets = new Set((manifest.schemas ?? []).map((schema) => schema.file));
  return (manifest.assembly?.loadOrder ?? []).map((assetPath) => ({
    relativePath: assetPath,
    kind: schemaAssets.has(assetPath) ? "schema" : "write"
  }));
}

function rewriteChunk(text, keyword, variablePrefix) {
  let chunk = text.replace(/^#.*\n/gm, "");
  chunk = chunk.replace(new RegExp(`^\\s*${keyword}\\s*\\n`, "i"), "");
  chunk = chunk.replace(/\$([A-Za-z][A-Za-z0-9_]*)/g, `\$${variablePrefix}_$1`);
  return chunk.trim();
}

async function writeMergedQueryFile(keyword, assets, outPath) {
  const chunks = [];

  for (const [index, asset] of assets.entries()) {
    let text = await fs.readFile(path.join(asset.packageRoot, asset.relativePath), "utf8");
    text = rewriteChunk(text, keyword, `${keyword}${index + 1}`);
    if (text) chunks.push(text);
  }

  // If chunks contain put-prefixed statements, emit them directly
  // (each put is a self-contained write statement, no insert wrapper needed)
  const hasPut = chunks.some((chunk) => /^put /m.test(chunk));
  const merged = hasPut
    ? `${chunks.join("\n\n")}\n`
    : `${keyword}\n\n${chunks.join("\n\n")}\n`;
  await fs.writeFile(outPath, merged, "utf8");
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
    server.on("error", reject);
  });
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

  return { child, grpcPort, typedb };
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

function runTypedbScript(typedb, grpcPort, scriptPath, cwd) {
  return spawnSync(
    typedb,
    [
      "console",
      `--address=127.0.0.1:${grpcPort}`,
      "--username=admin",
      "--password=password",
      "--tls-disabled",
      "--script",
      scriptPath
    ],
    { cwd, encoding: "utf8" }
  );
}

// ── Put-statement batching ─────────────────────────────────────────

const BATCH_SIZE = 50;

function splitPutStatements(text) {
  const stmts = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#") || t === "") continue;
    if (t.startsWith("put ") && cur) { stmts.push(cur.trim()); cur = line; }
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

async function writeDataBatchFiles(writeAssets, tempDir) {
  let allText = "";
  for (const [index, asset] of writeAssets.entries()) {
    const text = await fs.readFile(path.join(asset.packageRoot, asset.relativePath), "utf8");
    const chunk = rewriteChunk(text, "insert", `write${index + 1}`);
    if (chunk) allText += chunk + "\n\n";
  }

  const groups = groupPutStatements(splitPutStatements(allText));
  if (groups.length === 0) return [];

  const preambles = findPreambles(groups);
  const preambleVars = new Set(preambles.map((g) => g.variable));
  const contentGroups = groups.filter((g) => !preambleVars.has(g.variable));
  const preambleText = preambles.flatMap((g) => g.statements).join("\n\n");

  const batchFiles = [];
  for (let i = 0; i < contentGroups.length; i += BATCH_SIZE) {
    const batch = contentGroups.slice(i, i + BATCH_SIZE);
    const body = batch.flatMap((g) => g.statements).join("\n\n");
    const text = preambleText ? `${preambleText}\n\n${body}\n` : `${body}\n`;
    const filePath = path.join(tempDir, `data-batch-${batchFiles.length}.tql`);
    await fs.writeFile(filePath, text, "utf8");
    batchFiles.push(filePath);
  }
  return batchFiles;
}

async function main() {
  const orderedPackages = await resolvePackageOrder(root);
  const orderedNames = orderedPackages.map((item) => item.manifest.name);
  console.log(`Package order: ${orderedNames.join(" -> ")}`);

  const schemaAssets = [];
  const writeAssets = [];
  for (const pkg of orderedPackages) {
    for (const asset of classifyAssemblyAssets(pkg.manifest)) {
      const entry = { packageRoot: pkg.root, relativePath: asset.relativePath };
      if (asset.kind === "schema") {
        schemaAssets.push(entry);
      } else {
        writeAssets.push(entry);
      }
    }
  }

  const typedbTemp = await fs.mkdtemp(path.join(os.tmpdir(), "ontology-package-bootstrap-"));
  const mergedSchema = path.join(typedbTemp, "merged-schema.tql");
  const databaseName = `ontology_pkg_${process.pid}`;

  await writeMergedQueryFile("define", schemaAssets, mergedSchema);
  const dataBatchFiles = await writeDataBatchFiles(writeAssets, typedbTemp);

  let typedbServer;
  try {
    typedbServer = await startTypedbServer(typedbTemp);
    const { typedb, grpcPort } = typedbServer;

    // Create database and load schema
    const schemaScript = path.join(typedbTemp, "schema-script.tql");
    await fs.writeFile(schemaScript, `database create ${databaseName}\n\ntransaction schema ${databaseName}\n\nsource ${mergedSchema}\n\ncommit\n\nexit\n`, "utf8");
    const schemaResult = runTypedbScript(typedb, grpcPort, schemaScript, root);
    assertCondition(schemaResult.status === 0, `TypeDB schema load failed:\n${schemaResult.stdout}\n${schemaResult.stderr}`);

    // Load data in batches
    for (const batchFile of dataBatchFiles) {
      const batchScript = path.join(typedbTemp, `batch-${path.basename(batchFile)}.tql`);
      await fs.writeFile(batchScript, `transaction write ${databaseName}\n\nsource ${batchFile}\n\ncommit\n\nexit\n`, "utf8");
      const batchResult = runTypedbScript(typedb, grpcPort, batchScript, root);
      assertCondition(batchResult.status === 0, `TypeDB data batch load failed:\n${batchResult.stdout}\n${batchResult.stderr}`);
    }

    for (const packageName of orderedNames) {
      const queryScript = path.join(typedbTemp, `query-${packageName}.tql`);
      await fs.writeFile(
        queryScript,
        `transaction read ${databaseName}\n\nmatch\n$b isa OntologyPackageBuild,\n  has packageName "${packageName}";\nlimit 1;\n\nclose\n\nexit\n`,
        "utf8"
      );
      const query = runTypedbScript(typedbServer.typedb, typedbServer.grpcPort, queryScript, root);
      assertCondition(query.status === 0, `TypeDB provenance query failed for ${packageName}:\n${query.stdout}\n${query.stderr}`);
      assertCondition(
        query.stdout.includes("Finished. Total answers: 1"),
        `Expected OntologyPackageBuild row for ${packageName}:\n${query.stdout}`
      );
    }
  } finally {
    await stopProcess(typedbServer?.child);
    await fs.rm(typedbTemp, { recursive: true, force: true });
  }

  console.log("typedb bootstrap validation ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
