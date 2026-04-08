import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(basePath, relativePath) {
  return JSON.parse(await fs.readFile(path.join(basePath, relativePath), "utf8"));
}

function classifyAssemblyAssets(manifest) {
  const schemaAssets = new Set((manifest.schemas ?? []).map((schema) => schema.file));
  return (manifest.assembly?.loadOrder ?? []).map((assetPath) => ({
    relativePath: assetPath,
    kind: schemaAssets.has(assetPath) ? "schema" : "write"
  }));
}

function parseSemver(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function semverString(parsed) {
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function semverCompare(lhs, rhs) {
  if (lhs.major !== rhs.major) return lhs.major - rhs.major;
  if (lhs.minor !== rhs.minor) return lhs.minor - rhs.minor;
  return lhs.patch - rhs.patch;
}

function semverInRange(version, rangeStr) {
  const clauses = rangeStr.trim().split(/\s+/);
  for (const clause of clauses) {
    if (clause.startsWith(">=")) {
      const bound = parseSemver(clause.slice(2));
      if (!bound || semverCompare(version, bound) < 0) return false;
    } else if (clause.startsWith(">")) {
      const bound = parseSemver(clause.slice(1));
      if (!bound || semverCompare(version, bound) <= 0) return false;
    } else if (clause.startsWith("<=")) {
      const bound = parseSemver(clause.slice(2));
      if (!bound || semverCompare(version, bound) > 0) return false;
    } else if (clause.startsWith("<")) {
      const bound = parseSemver(clause.slice(1));
      if (!bound || semverCompare(version, bound) >= 0) return false;
    } else if (clause.endsWith(".x")) {
      const prefix = parseSemver(clause.replace(/\.x$/, ".0"));
      if (!prefix || version.major !== prefix.major || version.minor !== prefix.minor) return false;
    } else {
      const exact = parseSemver(clause);
      if (!exact || semverCompare(version, exact) !== 0) return false;
    }
  }
  return true;
}

function gitTags(repoPath) {
  const output = execFileSync("git", ["tag", "--list", "v*"], { cwd: repoPath, encoding: "utf8" });
  return output.trim().split("\n").filter(Boolean);
}

function matchingBaseVersionTags(repoPath, fromRange) {
  return gitTags(repoPath)
    .map((tag) => ({ tag, version: parseSemver(tag) }))
    .filter(({ version }) => version && semverInRange(version, fromRange))
    .sort((lhs, rhs) => semverCompare(lhs.version, rhs.version));
}

function checkoutToTemp(repoPath, tag) {
  const tempDir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
  execFileSync("git", ["worktree", "add", "--detach", tempDir, tag], { cwd: repoPath, encoding: "utf8" });
  return tempDir;
}

function removeWorktree(repoPath, worktreePath) {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], { cwd: repoPath, encoding: "utf8" });
  } catch {
    // Best effort
  }
}

function rewriteChunk(text, keyword, variablePrefix) {
  const sanitizedPrefix = variablePrefix.replace(/[^A-Za-z0-9_]+/g, "_");
  let chunk = text.replace(/^#.*\n/gm, "");
  chunk = chunk.replace(new RegExp(`^\\s*${keyword}\\s*\\n`, "i"), "");
  chunk = chunk.replace(/\$([A-Za-z][A-Za-z0-9_]*)/g, `\$${sanitizedPrefix}_$1`);
  return chunk.trim();
}

async function writeMergedQueryFile(keyword, assets, outPath) {
  const chunks = [];
  for (const [index, asset] of assets.entries()) {
    let text = await fs.readFile(path.join(asset.packageRoot, asset.relativePath), "utf8");
    text = rewriteChunk(text, keyword, `${keyword}${index + 1}`);
    if (text) chunks.push(text);
  }

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

function declaredVariablesForBlock(block) {
  return [...block.matchAll(/\$([A-Za-z][A-Za-z0-9_]*)\s+isa\b/g)].map((match) => match[1]);
}

function referencedVariablesForBlock(block) {
  return [...block.matchAll(/\$([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]);
}

function atomicWriteBlocks(trimmed) {
  const blocks = trimmed
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length > 1) {
    return blocks;
  }

  const statements = trimmed.match(/[\s\S]*?;/g) ?? [];
  if (statements.length === 0) {
    return [trimmed];
  }

  const statementBlocks = [];
  for (let index = 0; index < statements.length; index++) {
    const current = statements[index].trim();
    const referencedVariables = referencedVariablesForBlock(current);
    const blockStatements = [current];
    const next = statements[index + 1]?.trim();
    if (
      next &&
      (next.startsWith("put (") || next.startsWith("match")) &&
      referencedVariables.some((name) => next.includes(`$${name}`))
    ) {
      blockStatements.push(next);
      index += 1;
    }
    statementBlocks.push(blockStatements.join("\n"));
  }

  return statementBlocks;
}

function contextualBlockChunks(blocks, maxBlocks = 5) {
  if (blocks.length <= maxBlocks) {
    return [blocks.join("\n\n").trim()].filter(Boolean);
  }

  const declarationIndexByVariable = new Map();
  blocks.forEach((block, index) => {
    for (const variable of declaredVariablesForBlock(block)) {
      if (!declarationIndexByVariable.has(variable)) {
        declarationIndexByVariable.set(variable, index);
      }
    }
  });

  const chunks = [];
  for (let start = 0; start < blocks.length; start += maxBlocks) {
    const end = Math.min(start + maxBlocks, blocks.length);
    const selectedIndexes = new Set();
    for (let index = start; index < end; index += 1) {
      selectedIndexes.add(index);
    }

    const contextIndexes = new Set();
    const pending = [];
    for (let index = start; index < end; index += 1) {
      for (const variable of referencedVariablesForBlock(blocks[index])) {
        const declarationIndex = declarationIndexByVariable.get(variable);
        if (declarationIndex !== undefined && declarationIndex < start) {
          pending.push(declarationIndex);
        }
      }
    }

    while (pending.length > 0) {
      const declarationIndex = pending.pop();
      if (declarationIndex === undefined || selectedIndexes.has(declarationIndex) || contextIndexes.has(declarationIndex)) {
        continue;
      }
      contextIndexes.add(declarationIndex);
      for (const variable of referencedVariablesForBlock(blocks[declarationIndex])) {
        const dependencyIndex = declarationIndexByVariable.get(variable);
        if (
          dependencyIndex !== undefined
          && dependencyIndex < start
          && !selectedIndexes.has(dependencyIndex)
          && !contextIndexes.has(dependencyIndex)
        ) {
          pending.push(dependencyIndex);
        }
      }
    }

    const orderedIndexes = [...contextIndexes, ...selectedIndexes].sort((lhs, rhs) => lhs - rhs);
    chunks.push(orderedIndexes.map((index) => blocks[index]).join("\n\n").trim());
  }

  return chunks.filter(Boolean);
}

function splitWriteChunk(chunk, maxBlocks = 5) {
  const trimmed = chunk.trim();
  if (!/^put\b/m.test(trimmed) && !/^match\b/m.test(trimmed)) {
    return [trimmed];
  }
  return contextualBlockChunks(atomicWriteBlocks(trimmed), maxBlocks);
}

function chunkingError(output) {
  return output.includes("broken pipe")
    || output.includes("stream closed")
    || output.includes("h2 protocol error");
}

async function applyWriteChunk(typedb, grpcPort, tempDir, databaseName, chunk, context, maxBlocks = 5) {
  const chunks = splitWriteChunk(chunk, maxBlocks);

  for (const [index, writeChunk] of chunks.entries()) {
    const dataFile = path.join(tempDir, `${context.replaceAll(/[^A-Za-z0-9_-]+/g, "_")}-${maxBlocks}-${index + 1}.tql`);
    await fs.writeFile(dataFile, `${writeChunk}\n`, "utf8");
    const loadScript = path.join(tempDir, `${context.replaceAll(/[^A-Za-z0-9_-]+/g, "_")}-${maxBlocks}-${index + 1}-load.tql`);
    await fs.writeFile(
      loadScript,
      `transaction write ${databaseName}\n\nsource ${dataFile}\n\ncommit\n\nexit\n`,
      "utf8"
    );

    const load = runTypedbScript(typedb, grpcPort, loadScript, root);
    if (load.status === 0) continue;

    const output = `${load.stdout}\n${load.stderr}`;
    if (maxBlocks > 1 && chunkingError(output)) {
      await applyWriteChunk(typedb, grpcPort, tempDir, databaseName, writeChunk, `${context}-retry-${index + 1}`, Math.max(1, Math.floor(maxBlocks / 2)));
      continue;
    }

    assertCondition(false, `TypeDB data chunk load failed (${context} chunk ${index + 1}):\n${output}`);
  }
}

async function runSchemaScript(typedb, grpcPort, tempDir, databaseName, queryFilePath, context) {
  const scriptPath = path.join(tempDir, `${context.replaceAll(/[^A-Za-z0-9_-]+/g, "_")}-script.tql`);
  await fs.writeFile(
    scriptPath,
    `transaction schema ${databaseName}\n\nsource ${queryFilePath}\n\ncommit\n\nexit\n`,
    "utf8"
  );
  const result = runTypedbScript(typedb, grpcPort, scriptPath, root);
  assertCondition(result.status === 0, `${context} failed:\n${result.stdout}\n${result.stderr}`);
}

async function runReadQuery(typedb, grpcPort, tempDir, databaseName, query, context) {
  const scriptPath = path.join(tempDir, `${context.replaceAll(/[^A-Za-z0-9_-]+/g, "_")}.tql`);
  await fs.writeFile(
    scriptPath,
    `transaction read ${databaseName}\n\n${query.trim()}\n\nclose\n\nexit\n`,
    "utf8"
  );
  const result = runTypedbScript(typedb, grpcPort, scriptPath, root);
  assertCondition(result.status === 0, `${context} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function createDatabase(typedb, grpcPort, tempDir, databaseName) {
  const scriptPath = path.join(tempDir, "create-db.tql");
  await fs.writeFile(scriptPath, `database create ${databaseName}\n\nexit\n`, "utf8");
  const result = runTypedbScript(typedb, grpcPort, scriptPath, root);
  assertCondition(result.status === 0, `Database creation failed:\n${result.stdout}\n${result.stderr}`);
}

async function loadSchemaAndData(typedb, grpcPort, tempDir, databaseName, packageRoot, label) {
  const manifest = await readJson(packageRoot, "package.json");
  const schemaAssets = [];
  const writeAssets = [];

  for (const asset of classifyAssemblyAssets(manifest)) {
    const entry = { packageRoot, relativePath: asset.relativePath };
    if (asset.kind === "schema") {
      schemaAssets.push(entry);
    } else {
      writeAssets.push(entry);
    }
  }

  const mergedSchema = path.join(tempDir, `${label}-schema.tql`);
  await writeMergedQueryFile("define", schemaAssets, mergedSchema);
  await runSchemaScript(typedb, grpcPort, tempDir, databaseName, mergedSchema, `${label}-schema`);
  console.log(`${label}: schema loaded`);

  for (const [index, asset] of writeAssets.entries()) {
    const text = await fs.readFile(path.join(asset.packageRoot, asset.relativePath), "utf8");
    const chunk = rewriteChunk(text, "insert", `${label}_write${index + 1}`);
    if (!chunk) continue;
    console.log(`${label}: loading write asset ${index + 1}/${writeAssets.length} (${asset.relativePath})`);
    await applyWriteChunk(typedb, grpcPort, tempDir, databaseName, chunk, `${label}-asset-${index + 1}`);
  }
  console.log(`${label}: data loaded`);
}

async function applyMigrationPlan(typedb, grpcPort, tempDir, databaseName, plan) {
  for (const phase of plan.phases) {
    console.log(`Running migration phase '${phase.id}' (${phase.units.length} units)`);
    for (const unit of phase.units) {
      const unitPath = path.join(root, unit.path);
      if (unit.kind === "schema") {
        await runSchemaScript(typedb, grpcPort, tempDir, databaseName, unitPath, `migration-${phase.id}-${path.basename(unit.path, ".tql")}`);
      } else if (unit.kind === "write") {
        const unitContent = await fs.readFile(unitPath, "utf8");
        const rewritten = rewriteChunk(unitContent, "insert", `migration_${phase.id}_${path.basename(unit.path, ".tql")}`);
        await applyWriteChunk(typedb, grpcPort, tempDir, databaseName, rewritten, `migration-${phase.id}-${path.basename(unit.path, ".tql")}`);
      } else {
        assertCondition(false, `Unsupported migration unit kind '${unit.kind}' for gist migration test`);
      }
      console.log(`  Applied ${unit.kind} unit: ${path.basename(unit.path)}`);
    }
  }
}

async function verifyProvenance(typedb, grpcPort, tempDir, databaseName, manifest) {
  const output = await runReadQuery(
    typedb,
    grpcPort,
    tempDir,
    databaseName,
    `
    match
      $module isa OntologyModule, has moduleName "${manifest.name}";
      $version isa OntologyModuleVersion, has moduleVersion "${manifest.version}";
      (version: $version, module: $module) isa ontologyModuleVersionOf;
    limit 1;
    `,
    `verify-${manifest.name}-${manifest.version}`
  );
  assertCondition(
    output.includes("Finished. Total answers: 1"),
    `Expected OntologyModuleVersion row for ${manifest.name}@${manifest.version}:\n${output}`
  );
}

async function main() {
  const manifest = await readJson(root, "package.json");
  const migration = manifest.migration;

  assertCondition(migration?.plans?.length > 0, "Current gist package is missing migration plans.");

  for (const plan of migration.plans) {
    const baseCandidates = matchingBaseVersionTags(root, plan.from);
    assertCondition(baseCandidates.length > 0, `No git tags match migration source range '${plan.from}'.`);

    for (const base of baseCandidates) {
      console.log(`Migration plan: ${plan.id} (from ${base.tag} -> ${manifest.version})`);

      let baseWorktree;
      let typedbServer;
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ontology-gist-migration-"));
      const databaseName = `ontology_gist_${base.version.major}_${base.version.minor}_${base.version.patch}_${process.pid}`;

      try {
        baseWorktree = checkoutToTemp(root, base.tag);
        console.log(`Checked out ${base.tag} to ${baseWorktree}`);

        typedbServer = await startTypedbServer(tempRoot);
        const { typedb, grpcPort } = typedbServer;
        await createDatabase(typedb, grpcPort, tempRoot, databaseName);

        await loadSchemaAndData(typedb, grpcPort, tempRoot, databaseName, baseWorktree, "base");
        await applyMigrationPlan(typedb, grpcPort, tempRoot, databaseName, plan);
        await loadSchemaAndData(typedb, grpcPort, tempRoot, databaseName, root, "current");
        await verifyProvenance(typedb, grpcPort, tempRoot, databaseName, manifest);

        console.log(`Migration validation ok for ${base.tag} -> ${manifest.version}`);
      } finally {
        await stopProcess(typedbServer?.child);
        await fs.rm(tempRoot, { recursive: true, force: true });
        if (baseWorktree) {
          removeWorktree(root, baseWorktree);
        }
      }
    }
  }

  console.log("typedb migration validation ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
