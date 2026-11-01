import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPowerShell } from "./util/ps.js";

/**
 * A simple terminal for the web UI. Each line runs in a fresh PowerShell process
 * but the working directory is remembered here, so `cd` feels persistent.
 */

let cwd = process.cwd();
const history: string[] = [];

export function getTerminalCwd(): string {
  return cwd;
}

export function setTerminalCwd(target: string): string {
  const resolved = path.resolve(cwd, target.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (!fs.existsSync(resolved)) throw new Error(`no such directory: ${resolved}`);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`not a directory: ${resolved}`);
  cwd = resolved;
  return cwd;
}

export function addTerminalHistory(line: string): void {
  if (line.trim()) history.push(line);
  if (history.length > 200) history.shift();
}

export function getTerminalHistory(): string[] {
  return history;
}

export interface TerminalResult {
  output: string;
  cwd: string;
  exitCode: number;
}

/** Run one shell line in the terminal's working directory. */
export async function runShellLine(line: string): Promise<TerminalResult> {
  const trimmed = line.trim();

  const cd = /^cd(?:\s+(.*))?$/i.exec(trimmed);
  if (cd) {
    const target = (cd[1] ?? "").trim();
    if (target === "" || target === "~") {
      cwd = os.homedir();
    } else {
      setTerminalCwd(target.replace(/^"|"$/g, ""));
    }
    return { output: cwd, cwd, exitCode: 0 };
  }

  const result = await runPowerShell(trimmed, { cwd, timeoutMs: 120_000 });
  const combined = `${result.stdout}${result.stderr}`.trim();
  const output = combined || "(no output)";
  return {
    output: result.code === 0 ? output : `exit code ${result.code}\n${output}`,
    cwd,
    exitCode: result.code,
  };
}
