import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCommand } from "./exec.js";

/**
 * Runs PowerShell scripts safely on Windows.
 *
 * Scripts are passed via `-EncodedCommand` (base64 of UTF-16LE), which
 * completely avoids the quoting/escaping problems of the Windows command line.
 *
 * Three Windows-specific problems are handled here, because they otherwise show
 * up as "the tool is broken":
 *
 * - **Localized errors.** A Chinese, German or Japanese Windows answers
 *   `Access is denied` in its own language. Fine for a human, useless for a
 *   small local model (and for the hints below). The prologue pins the *UI*
 *   culture to English so error text is always English, while dates and numbers
 *   keep the user's format.
 * - **Elevation.** Half of the interesting PowerShell cmdlets (services,
 *   firewall, machine-wide registry/environment) need an administrator. The
 *   agent knows whether it is elevated and says so instead of forwarding a bare
 *   "access denied".
 * - **Hung children.** Killing `powershell.exe` on Windows does not kill the
 *   program it started (`robocopy`, a stuck `Test-Connection`, ...), so a
 *   timeout kills the whole process tree.
 */

let POWERSHELL = "powershell.exe";
/** When true (the default) PowerShell error messages are forced to English. */
let ENGLISH_ERRORS = true;
/** Cached PATH lookup for `POWERSHELL`, so every tool call does not rescan PATH. */
let resolvedPowerShell: { exe: string; found: boolean; tried: string[] } | null = null;

/** Where Windows keeps PowerShell when it is not on PATH. */
function fallbackPowerShell(): string[] {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return [
    path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    path.join(programFilesX86, "PowerShell", "7", "pwsh.exe"),
  ];
}

/** Switch the PowerShell binary at runtime (e.g. pwsh.exe for PowerShell 7). */
export function configurePowerShell(exe: string): void {
  if (exe && exe.trim()) POWERSHELL = exe.trim();
  resolvedPowerShell = null;
  cachedInfo = null;
}

/** Force English error messages on or off (settings: `psEnglishErrors`). */
export function configurePowerShellDiagnostics(englishErrors: boolean): void {
  ENGLISH_ERRORS = englishErrors !== false;
  // The panel in the UI shows this flag; keep the cached answer honest.
  if (cachedInfo) cachedInfo = { ...cachedInfo, englishErrors: ENGLISH_ERRORS };
}

export function currentPowerShell(): string {
  return POWERSHELL;
}

/**
 * The PowerShell binary that will actually be started, plus the candidates that
 * were tried. A bare name is looked up on PATH; well-known install locations are
 * the last resort, so a machine where PowerShell is not on PATH still works.
 */
export function resolvePowerShell(): { exe: string; found: boolean; tried: string[] } {
  if (resolvedPowerShell) return resolvedPowerShell;
  const tried: string[] = [];
  const candidates = [POWERSHELL, ...fallbackPowerShell()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    tried.push(candidate);
    if (/[\\/]/.test(candidate)) {
      try {
        if (fs.existsSync(candidate)) return { exe: candidate, found: true, tried };
      } catch {
        // unreadable path - keep looking
      }
      continue;
    }
    const resolved = resolveCommand(candidate);
    if (resolved !== candidate || fs.existsSync(candidate)) {
      resolvedPowerShell = { exe: resolved, found: true, tried };
      return resolvedPowerShell;
    }
  }
  resolvedPowerShell = { exe: POWERSHELL, found: false, tried };
  return resolvedPowerShell;
}

/** Build the prologue every script runs with. */
function prologue(): string {
  const lines = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
    "$OutputEncoding=[System.Text.Encoding]::UTF8",
  ];
  if (ENGLISH_ERRORS) {
    // Only the *message* language changes; -f and ConvertTo-Json keep the
    // user's date/number formats, so nothing that is parsed breaks.
    lines.push(
      "[System.Threading.Thread]::CurrentThread.CurrentUICulture=[System.Globalization.CultureInfo]::GetCultureInfo('en-US')",
    );
  }
  return lines.join("; ");
}

export interface PsOptions {
  timeoutMs?: number;
  cwd?: string;
}

export interface PsResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when the script had to be killed because it ran too long. */
  timedOut: boolean;
}

/** Quote an arbitrary string for safe embedding inside a PowerShell script. */
export function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/**
 * Turn a CLIXML error blob back into plain text.
 *
 * Windows PowerShell 5.1 does not write error text to a *redirected* stderr; it
 * serializes error records as CLIXML:
 *
 *     #< CLIXML
 *     <Objs Version="1.1.0.1" ...><S S="Error">Get-Service : Cannot find any
 *     service with service name 'x'.</S>...
 *
 * A model cannot read that, the "access denied" hints below do not match it, and
 * it is noise in the UI. PowerShell 7 does not do this, and neither does an
 * interactive console - which is why it only shows up once the agent runs.
 */
export function stripClixml(text: string): string {
  if (!text.includes("<Objs Version=")) return text;
  const parts: string[] = [];
  for (const match of text.matchAll(/<S S="(?:Error|Warning)">([\s\S]*?)<\/S>/g)) {
    const clean = decodeXmlText(match[1]).trim();
    if (clean) parts.push(clean);
  }
  if (parts.length === 0) return text;
  return condenseErrorParts(parts).join("\n");
}

/**
 * Drop the parts of a PowerShell error that only exist for a console.
 *
 * An error record is printed as four blocks: the message, the *location*
 * ("At line:1 char:293" - and this one is NOT translated by the culture pin,
 * so it is the only Chinese text left in an otherwise English error), the source
 * echo, and the CategoryInfo/FullyQualifiedErrorId pair. Everything after the
 * message starts with "+", which makes the split locale-independent.
 */
function condenseErrorParts(parts: string[]): string[] {
  const drop = new Set<number>();
  parts.forEach((part, index) => {
    if (/^\s*\+/.test(part)) {
      drop.add(index);
      return;
    }
    // The location line sits right above the first "+" line and always ends with
    // a character offset, in every language ("At line:1 char:293",
    // "所在位置 行:1 字符: 293", "In Zeile:1 Zeichen:293").
    const next = parts[index + 1];
    if (next && /^\s*\+/.test(next) && part.length < 120 && /\d\s*$/.test(part)) drop.add(index);
  });
  if (drop.size === 0) return parts;
  return parts.filter((_, index) => !drop.has(index));
}

/** Undo the escaping CLIXML uses for characters XML cannot carry. */
function decodeXmlText(value: string): string {
  return value
    .replace(/_x000D_/g, "\r")
    .replace(/_x000A_/g, "\n")
    .replace(/_x0009_/g, "\t")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Kill a process and everything it started (`child.kill()` misses children). */
function killTree(pid: number | undefined, fallback: () => void): void {
  if (!pid) {
    fallback();
    return;
  }
  try {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    killer.on("error", () => fallback());
    killer.on("close", (code) => {
      if (code !== 0) fallback();
    });
  } catch {
    fallback();
  }
}

/** Run a PowerShell script and resolve with the raw result (never throws on non-zero exit). */
export function runPowerShell(script: string, options: PsOptions = {}): Promise<PsResult> {
  const full = `${prologue()}; ${script}`;
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

  const timeoutMs = options.timeoutMs ?? 60_000;
  const { exe, found, tried } = resolvePowerShell();

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(exe, argv, { windowsHide: true, cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, () => child.kill());
    }, timeoutMs);

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
      if (settled) return;
      settled = true;
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT" && !found) {
        reject(
          new Error(
            `PowerShell was not found. The setting "PowerShell binary" is ${JSON.stringify(POWERSHELL)} ` +
              `and none of these exist: ${tried.join(", ")}. Set it to powershell.exe or a full path.`,
          ),
        );
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      // Windows PowerShell reports errors as CLIXML when stderr is redirected.
      const clean = stripClixml(stderr);
      if (timedOut) {
        resolve({
          code: code ?? -1,
          stdout,
          stderr: `${clean}\nthe command did not finish within ${timeoutMs} ms and was killed (with everything it started)`,
          timedOut: true,
        });
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr: clean, timedOut: false });
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Elevation and error hints                                                  */
/* -------------------------------------------------------------------------- */

let elevated: boolean | null = null;
let pendingElevation: Promise<boolean | null> | null = null;

/** Whether the agent runs with administrator rights (cached, never throws). */
export function isElevated(): boolean | null {
  return elevated;
}

/** Ask Windows once whether this process is elevated. */
export function detectElevation(): Promise<boolean | null> {
  if (elevated !== null) return Promise.resolve(elevated);
  if (pendingElevation) return pendingElevation;
  pendingElevation = probeElevation().finally(() => {
    pendingElevation = null;
  });
  return pendingElevation;
}

async function probeElevation(): Promise<boolean | null> {
  try {
    const out = await runPs(
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())." +
        "IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      { timeoutMs: 20_000 },
    );
    elevated = /^true$/i.test(out.trim());
  } catch {
    elevated = null; // unknown - never block a tool because of this
  }
  return elevated;
}

let cachedInfo: PowerShellInfo | null = null;
/** The detection that is currently running, so callers share one PowerShell call. */
let pendingInfo: Promise<PowerShellInfo> | null = null;

export interface PowerShellInfo {
  /** The binary the agent starts. */
  exe: string;
  /** False when no candidate exists - every tool would fail. */
  found: boolean;
  /** e.g. "5.1.26100.9444" or "" when it could not be asked. */
  version: string;
  /** "Desktop" (Windows PowerShell) or "Core" (PowerShell 7). */
  edition: string;
  /** null = could not be determined. */
  elevated: boolean | null;
  /** Errors are forced to English (so a small model can read them). */
  englishErrors: boolean;
}

/** Version, edition, elevation and the binary actually used (cached). */
export function powerShellInfo(force = false): Promise<PowerShellInfo> {
  if (cachedInfo && !force) return Promise.resolve(cachedInfo);
  if (pendingInfo) return pendingInfo;
  pendingInfo = detectPowerShellInfo().finally(() => {
    pendingInfo = null;
  });
  return pendingInfo;
}

async function detectPowerShellInfo(): Promise<PowerShellInfo> {
  const { exe, found } = resolvePowerShell();
  cachedInfo = { exe, found, version: "", edition: "", elevated: await detectElevation(), englishErrors: ENGLISH_ERRORS };
  if (found) {
    try {
      const out = await runPs(
        "[pscustomobject]@{ version = $PSVersionTable.PSVersion.ToString(); edition = $PSVersionTable.PSEdition } | ConvertTo-Json -Compress",
        { timeoutMs: 20_000 },
      );
      const parsed = JSON.parse(out) as { version?: string; edition?: string };
      cachedInfo = { ...cachedInfo, version: parsed.version ?? "", edition: parsed.edition ?? "" };
    } catch {
      // A host that refuses to answer is not a reason to fail; the panel just
      // shows what is known.
    }
  }
  cachedInfo = { ...cachedInfo, englishErrors: ENGLISH_ERRORS };
  return cachedInfo;
}

/**
 * Permission and "not found" failures are the two Windows errors a model cannot
 * fix by itself. Turn them into one sentence with the next step, so the model
 * stops retrying the same call.
 */
export function explainPowerShellError(text: string): string {
  const body = text.trim();
  if (!body) return body;

  const permission =
    /access is denied|access to the path .* is denied|requires elevation|requested operation requires elevation|denied by policy|\b0x80070005\b|requested registry access is not allowed|cannot open.*for writing/i.test(
      body,
    );
  if (permission) {
    if (elevated === false) {
      return `${body}\n(this needs administrator rights and win-agent is NOT elevated - restart win-agent from an elevated PowerShell, or ask the user to do it)`;
    }
    if (elevated === null) {
      return `${body}\n(this usually means administrator rights are required)`;
    }
    return `${body}\n(already elevated, so the file or object itself is protected - check its permissions or whether it is in use)`;
  }

  const notFound =
    /is not recognized as the name of a cmdlet|the term .* is not recognized|cannot find the path|does not exist|no such file/i.test(
      body,
    );
  if (notFound) {
    return `${body}\n(check the spelling and pass a full path, e.g. C:\\Users\\Name\\file.txt)`;
  }

  if (/cannot find any service|does not exist as an installed service/i.test(body)) {
    return `${body}\n(use the short service name, e.g. Spooler - "services list" shows the names)`;
  }

  return body;
}

/** Run a script and return trimmed stdout, throwing on failure. */
export async function runPs(script: string, options: PsOptions = {}): Promise<string> {
  const { code, stdout, stderr } = await runPowerShell(script, options);
  if (code !== 0) {
    const detail = (stderr || stdout).trim() || `PowerShell exited with code ${code}`;
    throw new Error(explainPowerShellError(detail));
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

/** Best-effort directory of the running PowerShell, for notes in the UI. */
export function powerShellDir(): string {
  const { exe, found } = resolvePowerShell();
  return found ? path.dirname(exe) : "";
}
