import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadOntologyModel, sortObject } from "./model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  const summary = sortObject(await loadOntologyModel(root));
  const output = JSON.stringify(summary, null, 2) + "\n";

  if (outPath) {
    const resolvedOut = path.isAbsolute(outPath) ? outPath : path.join(root, outPath);
    await fs.writeFile(resolvedOut, output, "utf8");
    return;
  }

  process.stdout.write(output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
