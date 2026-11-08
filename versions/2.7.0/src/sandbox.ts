import fs from "node:fs";
import path from "node:path";
import { getSettings } from "./settings.js";

/**
 * The sandbox: the one folder the agent's file tools may touch.
 *
 * When the `sandbox` setting is on - it is on by default - every path a tool is
 * handed has to land inside the working directory. `..\..\Windows\System32` and
 * `C:\somewhere\else` are refused with a message that says what to do instead,
 * which is what a small model needs: a dead end plus the way out.
 *
 * Two things make this more than a string check:
 *  - junctions and symlinks are followed (`realpath`) before the decision, so a
 *    link inside the sandbox that points outside is not a way out;
 *  - the check happens in the tools themselves (files, web download), not in the
 *    prompt, so "the model was told not to" is never the only thing standing in
 *    the way.
 *
 * What it deliberately does not cover: structured tools that act on machine
 * state rather than files (services, processes, registry, scheduled tasks), your
 * own `custom` commands (they are code you wrote and approved, so they are left
 * alone), and MCP servers, which are separate programs the user configured.
 *
 * The second half of the file is the *command* fence: with the sandbox on, a
 * PowerShell script is read before it runs (scanScript), so a literal path out of
 * the folder, a `..`, a `$env:` that resolves outside it, or a disk-destroying
 * command is refused instead of approved. It is a guard, not a jail - a path the
 * script only learns while it runs cannot be read - and the README says so.
 */

/** Raised when a path is outside the sandbox. The registry turns it into `Refused: ...`. */
export class SandboxRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxRefusal";
  }
}

/** Is the sandbox switched on? On unless the setting was explicitly turned off. */
export function sandboxEnabled(): boolean {
  return getSettings().sandbox !== false;
}

/** The one folder the agent may touch while the sandbox is on (the working directory). */
export function sandboxRoot(): string {
  const workdir = getSettings().workdir;
  return path.resolve(workdir && workdir.trim() !== "" ? workdir : process.cwd());
}

/** True when `child` is `parent` itself or lives underneath it. Windows-aware. */
export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  if (relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * The real location of a path that may not exist yet: the longest existing
 * ancestor is resolved (links and junctions followed), the missing tail is
 * appended again. `D:\work\link\to\C` therefore comes back as `C:\...`.
 */
function realPath(target: string): string {
  const absolute = path.resolve(target);
  let current = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      // Nothing along the path exists (a brand-new drive-less path): fall back
      // to the plain resolution rather than looping at the root forever.
      if (parent === current) return absolute;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/** The message a refused path gets: what was blocked, and the three ways out. */
export function refusalMessage(target: string, root: string): string {
  return (
    `${target} is outside the sandbox (${root}), so nothing was touched. ` +
    `Work inside ${root}, change the working directory, or switch the sandbox off in Settings.`
  );
}

/**
 * Resolve a tool argument to an absolute path, refusing anything outside the
 * working directory while the sandbox is on. Relative paths keep being resolved
 * against the current working directory, exactly as before.
 */
export function jailPath(value: string): string {
  const target = path.resolve(process.cwd(), value);
  if (!sandboxEnabled()) return target;
  const root = sandboxRoot();
  if (isInside(root, target) && isInside(realPath(root), realPath(target))) return target;
  throw new SandboxRefusal(refusalMessage(target, root));
}

/* -------------------------------------------------------------------------- */
/* The command guard: the same fence, applied to a PowerShell script           */
/* -------------------------------------------------------------------------- */

/** What the guard decided about a script. */
export type ScriptVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Commands the sandbox never runs, whatever the arguments say. They are not file
 * paths, so the fence below cannot see them, and they are the ones that destroy
 * something no audit entry can put back (a volume, a partition table, a boot
 * configuration). Everything else a script can do is a decision for the approval
 * prompt, not for a pattern match.
 */
const BLOCKED_COMMANDS: Array<[RegExp, string]> = [
  [/\bFormat-Volume\b/i, "it formats a volume"],
  [/\bClear-Disk\b/i, "it wipes a disk"],
  [/\bInitialize-Disk\b/i, "it re-initialises a disk"],
  [/\bRemove-Partition\b/i, "it deletes a partition"],
  [/\bdiskpart\b/i, "it drives diskpart"],
  [/\bbcdedit\b/i, "it rewrites the boot configuration"],
];

/** `C:\...`, `C:/...` - one letter, a colon, a separator, and not a URL scheme. */
const DRIVE_PATH = /(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s"'\r\n|;(){}]*/g;
/** `\\server\share\...` */
const UNC_PATH = /(?<!\\)\\\\[^\s"'\r\n|;(){}]+/g;
/** `..\...` and `../...` */
const PARENT_PATH = /(?<![A-Za-z0-9_.])\.\.[\\/][^\s"'\r\n|;(){}]*/g;
/** `~\...` */
const HOME_PATH = /(?<![A-Za-z0-9_])~[\\/][^\s"'\r\n|;(){}]*/g;
/** `$env:NAME` plus whatever follows it. */
const ENV_PATH = /\$env:([A-Za-z_][A-Za-z0-9_]*)((?:[\\/][^\s"'\r\n|;(){}]*)?)/gi;
/** Quoted strings, so a path with a space in it is read whole. */
const QUOTED = /"([^"\r\n]*)"|'([^'\r\n]*)'/g;

/** Environment variables are case-insensitive on Windows and not on Linux. */
function envValue(name: string): string | undefined {
  if (process.env[name] !== undefined) return process.env[name];
  const upper = name.toUpperCase();
  const key = Object.keys(process.env).find((entry) => entry.toUpperCase() === upper);
  return key ? process.env[key] : undefined;
}

/** The absolute path a token points at, when it is outside the fence; else null. */
function outsideOf(token: string, root: string): string | null {
  const candidate = token.trim().replace(/^["']+|["']+$/g, "").replace(/[,;]+$/, "");
  if (candidate === "") return null;
  const resolved = path.resolve(process.cwd(), candidate);
  if (isInside(root, resolved) && isInside(realPath(root), realPath(resolved))) return null;
  return resolved;
}

/** The sentence every refusal ends with, so the way out is always in the answer. */
function scriptRefusal(what: string, root: string): ScriptVerdict {
  return {
    ok: false,
    reason:
      `${what}, so the script was not run. The sandbox is on (${root}): work inside ` +
      `that folder, change the working directory, or switch the sandbox off in Settings.`,
  };
}

/**
 * Read a script and decide whether it may run while the sandbox is on.
 *
 * It is a guard, not a jail, and the difference is worth being honest about: the
 * script is text, so a path written as a literal, as `..`, or as `$env:SOMETHING`
 * is found and checked, and the four ways out are closed. A path the script only
 * learns while it runs (`Join-Path` over a variable it built itself) cannot be
 * checked by reading - that is what an OS-level sandbox is for, and it is not what
 * this is. What the guard buys is that the obvious, and by far the most common,
 * escape is a clear refusal before anything runs.
 */
export function scanScript(script: string): ScriptVerdict {
  if (!sandboxEnabled()) return { ok: true };
  const root = sandboxRoot();

  for (const [pattern, label] of BLOCKED_COMMANDS) {
    if (pattern.test(script)) return scriptRefusal(label, root);
  }

  // Downloading code and running it is the one thing no amount of reading can check.
  const downloads = /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString|DownloadFile)\b/i.test(script);
  const evaluates = /\b(iex|Invoke-Expression)\b/i.test(script);
  if (downloads && evaluates) {
    return scriptRefusal("it downloads code and runs it (Invoke-Expression)", root);
  }

  // `$env:` first: it is resolvable here, and it is how a script reaches %APPDATA%
  // without ever spelling a drive letter.
  for (const match of script.matchAll(ENV_PATH)) {
    const name = match[1];
    const tail = match[2] ?? "";
    const value = envValue(name);
    if (value === undefined) {
      return scriptRefusal(`it builds a path from $env:${name}, which cannot be checked`, root);
    }
    const outside = outsideOf(`${value}${tail}`, root);
    if (outside) return scriptRefusal(`"${outside}" (from $env:${name}) is outside the sandbox`, root);
  }

  // A quoted path is read whole, so "C:\Program Files\..." is named correctly.
  for (const match of script.matchAll(QUOTED)) {
    const text = match[1] ?? match[2] ?? "";
    if (!/^(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\.\.[\\/])/.test(text)) continue;
    const outside = outsideOf(text, root);
    if (outside) return scriptRefusal(`"${outside}" is outside the sandbox`, root);
  }

  for (const pattern of [DRIVE_PATH, UNC_PATH, PARENT_PATH, HOME_PATH]) {
    for (const match of script.matchAll(pattern)) {
      const outside = outsideOf(match[0], root);
      if (outside) return scriptRefusal(`"${outside}" is outside the sandbox`, root);
    }
  }

  return { ok: true };
}

