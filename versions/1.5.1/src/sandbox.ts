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
 * state rather than files (services, processes, registry, scheduled tasks), the
 * raw shell and custom scripts (both are withheld while the sandbox is on, see
 * src/tools/index.ts), and MCP servers, which are separate programs the user
 * configured themselves.
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
