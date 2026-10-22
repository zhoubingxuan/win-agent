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
/** Language of the one-line hint appended to a failure (`en` or `zh`). */
let HINT_LANGUAGE: "en" | "zh" = "en";
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

/**
 * Language of the hint appended to a failure (`language` setting). The PowerShell
 * text itself stays English; the one line that says what to do follows the UI.
 */
export function configureErrorHints(language: string | undefined): void {
  HINT_LANGUAGE = language === "zh" ? "zh" : "en";
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

/**
 * How much of each stream is kept. A `Get-Content` of a 2 GB log used to be
 * accumulated into one JS string, which is how a tool call could take the whole
 * process down with it. Past this the middle is dropped and the text says so.
 */
const STREAM_HEAD = 600_000;
const STREAM_TAIL = 400_000;
const MAX_STREAM_CHARS = STREAM_HEAD + STREAM_TAIL;

/** Collect a stream, keeping the head and the tail and counting what was dropped. */
function collector(): { push: (chunk: string) => void; text: () => string } {
  let head = "";
  let tail = "";
  let dropped = 0;
  return {
    push(chunk: string) {
      head += chunk;
      if (head.length > STREAM_HEAD) {
        tail += head.slice(STREAM_HEAD);
        head = head.slice(0, STREAM_HEAD);
        if (tail.length > STREAM_TAIL) {
          dropped += tail.length - STREAM_TAIL;
          tail = tail.slice(-STREAM_TAIL);
        }
      }
    },
    text() {
      if (dropped === 0) return head + tail;
      return `${head}\n... (${dropped} characters dropped: the output was larger than ${MAX_STREAM_CHARS}) ...\n${tail}`;
    },
  };
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
    const out = collector();
    const err = collector();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, () => child.kill());
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      err.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const failure = error as NodeJS.ErrnoException;
      if (failure.code === "ENOENT" && !found) {
        reject(
          new Error(
            `PowerShell was not found. The setting "PowerShell binary" is ${JSON.stringify(POWERSHELL)} ` +
              `and none of these exist: ${tried.join(", ")}. Set it to powershell.exe or a full path.`,
          ),
        );
        return;
      }
      reject(failure);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const stdout = out.text();
      // Windows PowerShell reports errors as CLIXML when stderr is redirected.
      const clean = stripClixml(err.text());
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
  /** Why the version is unknown, when it is - so the panel is never just blank. */
  note?: string;
}

/** Version, edition, elevation and the binary actually used (cached). */
export function powerShellInfo(force = false): Promise<PowerShellInfo> {
  // One probe at a time; a second caller shares the answer instead of racing it.
  if (pendingInfo) return pendingInfo;
  if (cachedInfo && !force) return Promise.resolve(cachedInfo);
  pendingInfo = detectPowerShellInfo().finally(() => {
    pendingInfo = null;
  });
  return pendingInfo;
}

async function detectPowerShellInfo(): Promise<PowerShellInfo> {
  const { exe, found } = resolvePowerShell();
  const elevated = await detectElevation();
  let version = "";
  let edition = "";
  let note: string | undefined;

  if (found) {
    try {
      const out = await runPs(
        "[pscustomobject]@{ version = $PSVersionTable.PSVersion.ToString(); edition = $PSVersionTable.PSEdition } | ConvertTo-Json -Compress",
        { timeoutMs: 20_000 },
      );
      const parsed = JSON.parse(out) as { version?: string; edition?: string };
      version = parsed.version ?? "";
      edition = parsed.edition ?? "";
    } catch (error) {
      // A host that refuses to answer is not a reason to fail; the panel says so.
      note = `could not read $PSVersionTable (${(error as Error).message.split("\n")[0]})`;
    }
  } else {
    note = "no PowerShell binary was found";
  }

  // Published once, complete: a half-filled object here used to leak into a
  // concurrent /api/state reply (elevation known, version still empty).
  cachedInfo = { exe, found, version, edition, elevated, englishErrors: ENGLISH_ERRORS, note };
  return cachedInfo;
}

/** One classification rule: what it matches, and what to tell the model to do. */
interface ErrorHint {
  test: RegExp;
  en: string;
  zh: string;
}

/**
 * The failures a small model actually meets, in the order they have to be tested:
 * the more specific pattern first, because PowerShell's text for a missing command
 * also contains "does not exist".
 */
const ERROR_HINTS: ErrorHint[] = [
  {
    test: /did not finish within \d+ ms and was killed/i,
    en: "the command was killed because it ran too long - do less per call (one file, one folder) or split it into steps",
    zh: "命令跑太久被终止了——每次少做一点（一个文件、一个目录），或者拆成几步",
  },
  {
    test: /cannot find any service|does not exist as an installed service/i,
    en: 'use the short service name, e.g. Spooler - "services list" shows the names',
    zh: '用短服务名，例如 Spooler——"services list" 会列出名字',
  },
  {
    test: /being used by another process|cannot access the file .* because it is being used|\b0x80070020\b/i,
    en: "the file is open in another program - close it (or ask the user to) and try again",
    zh: "这个文件正被别的程序占用——先关掉它（或请用户关掉），再重试",
  },
  {
    test: /parsererror|unexpected token|missing closing|missing the terminator|unexpected end of|unexpected '}'/i,
    en: "the script itself has a syntax error - fix the quotes/brackets before running it again",
    zh: "脚本本身有语法错误——先修好引号/括号，再重新运行",
  },
  {
    test: /cannot bind argument|a parameter cannot be found that matches parameter name|missing an argument for parameter/i,
    en: "a parameter name or type is wrong - check the cmdlet's parameters (Get-Help <cmdlet> -Parameter *)",
    zh: "参数名或参数类型不对——用 Get-Help <cmdlet> -Parameter * 看正确的参数",
  },
  {
    test: /is not recognized as the name of a cmdlet|the term .* is not recognized|commandnotfoundexception/i,
    en: "that command does not exist on this machine - check the spelling, or use the structured tool instead",
    zh: "这台机器上没有这个命令——检查拼写，或者改用结构化工具",
  },
  {
    test: /cannot find path|cannot find the file|the system cannot find the file specified|does not exist|no such file/i,
    en: "the path does not exist - pass a full path, and check the spelling of every folder",
    zh: "路径不存在——传完整路径，并逐个检查目录名是否拼对",
  },
  {
    test: /no such host|remote name could not be resolved|name or service not known|network path was not found|could not resolve/i,
    en: "the name or the network path could not be resolved - check the spelling and whether the machine is reachable",
    zh: "解析不到这个主机名或网络路径——检查拼写以及目标机器是否可达",
  },
  {
    test: /not enough space|disk is full|\b0x80070070\b/i,
    en: "the disk is full - free some space or write somewhere else",
    zh: "磁盘满了——清理一些空间，或者写到别的位置",
  },
];

/**
 * Permission and "not found" failures are the two Windows errors a model cannot
 * fix by itself. Turn them into one sentence with the next step, so the model
 * stops retrying the same call. The sentence follows the interface language; the
 * PowerShell text above it stays English (see ENGLISH_ERRORS).
 */
export function explainPowerShellError(text: string): string {
  const body = text.trim();
  if (!body) return body;
  const zh = HINT_LANGUAGE === "zh";

  const permission =
    /access is denied|access to the path .* is denied|requires elevation|requested operation requires elevation|denied by policy|\b0x80070005\b|requested registry access is not allowed|cannot open.*for writing/i.test(
      body,
    );
  if (permission) {
    if (elevated === false) {
      return `${body}\n(${
        zh
          ? "这需要管理员权限，而 win-agent 不是以管理员身份运行的——请从管理员 PowerShell 重新启动 win-agent，或请用户自己来做"
          : "this needs administrator rights and win-agent is NOT elevated - restart win-agent from an elevated PowerShell, or ask the user to do it"
      })`;
    }
    if (elevated === null) {
      return `${body}\n(${
        zh ? "这通常意味着需要管理员权限" : "this usually means administrator rights are required"
      })`;
    }
    return `${body}\n(${
      zh
        ? "已经是管理员了，所以是这个文件或对象本身受保护——检查它的权限，或者它是否正被占用"
        : "already elevated, so the file or object itself is protected - check its permissions or whether it is in use"
    })`;
  }

  for (const rule of ERROR_HINTS) {
    if (rule.test.test(body)) return `${body}\n(${zh ? rule.zh : rule.en})`;
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
