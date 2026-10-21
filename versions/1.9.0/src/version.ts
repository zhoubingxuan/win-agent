import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonWithBom } from "./util/json.js";

/**
 * The version comes from package.json so there is exactly one place to change it.
 * `package.json` sits one level above both `src/` and `dist/`, so the same
 * relative path works whether we run via tsx or from the build output.
 *
 * It is read *relative to this file*, never from the working folder: two copies
 * of the agent (two folders under `versions/`) must each report their own
 * version, no matter where they are started from.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  const candidates = [
    path.join(here, "..", "package.json"),
    path.join(here, "..", "..", "package.json"),
  ];
  for (const file of candidates) {
    try {
      const { value: parsed } = parseJsonWithBom<{ name?: string; version?: string }>(
        fs.readFileSync(file, "utf8"),
      );
      if (parsed.name === "win-agent" && typeof parsed.version === "string" && parsed.version) {
        return parsed.version;
      }
    } catch {
      // try the next candidate
    }
  }
  return "0.0.0";
}

export const VERSION = readVersion();

/** Short "win-agent 1.1.0" label used by the CLI, the UI and /version. */
export function versionLabel(): string {
  return `win-agent ${VERSION}`;
}
