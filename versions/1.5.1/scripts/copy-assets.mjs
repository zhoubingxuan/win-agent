// Copies the static web UI into dist/ after a TypeScript build.
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(root, "src", "web");
const to = path.join(root, "dist", "web");

await cp(from, to, { recursive: true });
console.log(`copied web assets -> ${path.relative(root, to)}`);
