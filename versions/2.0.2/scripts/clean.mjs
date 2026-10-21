// Removes build output so deleted sources do not linger in dist/.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
rmSync(path.join(root, "dist"), { recursive: true, force: true });
console.log("cleaned dist/");
