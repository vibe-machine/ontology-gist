import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const manifestRef = `manifests/gist-v${pkg.version}.translation-manifest.json`;
const pattern = /^# manifest: manifests\/gist-v[\d.]+\.translation-manifest\.json$/m;

const files = [
  ...pkg.schemas.map((s) => s.file),
  ...pkg.data,
  ...(pkg.queries ?? []),
];

for (const relPath of files) {
  const filePath = path.join(root, relPath);
  const text = await fs.readFile(filePath, "utf8");
  if (pattern.test(text)) {
    const updated = text.replace(pattern, `# manifest: ${manifestRef}`);
    if (updated !== text) {
      await fs.writeFile(filePath, updated, "utf8");
    }
  }
}
