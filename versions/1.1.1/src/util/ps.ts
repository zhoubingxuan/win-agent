import { spawn } from "node:child_process";

/**
 * Runs PowerShell scripts safely on Windows.
 *
 * Scripts are passed via `-EncodedCommand` (base64 of UTF-16LE), which
 * completely avoids the quoting/escaping problems of the Windows command line.
 */

let POWERSHELL = "powershell.exe";

/** Switch the PowerShell binary at runtime (e.g. pwsh.exe for PowerShell 7). */
export function configurePowerShell(exe: string): void {
  if (exe && exe.trim()) POWERSHELL = exe.trim();
}

export function currentPowerShell(): string {
  return POWERSHELL;
}

const PROLOGUE = [
  "$ErrorActionPreference='Stop'",
  "$ProgressPreference='SilentlyContinue'",
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
  "$OutputEncoding=[System.Text.Encoding]::UTF8",
].join("; ");

export interface PsOptions {
  timeoutMs?: number;
  cwd?: string;
}

export interface PsResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Quote an arbitrary string for safe embedding inside a PowerShell script. */
export function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/** Run a PowerShell script and resolve with the raw result (never throws on non-zero exit). */
export function runPowerShell(script: string, options: PsOptions = {}): Promise<PsResult> {
  const full = `${PROLOGUE}; ${script}`;
  const encoded = Buffer.from(full, "utf16le").toString("base64");
  const argv = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encoded,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL, argv, { windowsHide: true, cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, options.timeoutMs ?? 60_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Run a script and return trimmed stdout, throwing on failure. */
export async function runPs(script: string, options: PsOptions = {}): Promise<string> {
  const { code, stdout, stderr } = await runPowerShell(script, options);
  if (code !== 0) {
    const detail = (stderr || stdout).trim() || `PowerShell exited with code ${code}`;
    throw new Error(detail);
  }
  return stdout.trim();
}

/** Run a script that emits JSON and parse the result. Returns null for empty output. */
export async function runPsJson<T = unknown>(script: string, options: PsOptions = {}): Promise<T | null> {
  const out = await runPs(`${script} | ConvertTo-Json -Depth 6 -Compress`, options);
  if (!out) return null;
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new Error(`Expected JSON from PowerShell but got: ${out.slice(0, 300)}`);
  }
}

/** Normalise ConvertTo-Json output that may be a single object or an array. */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
