import fs from "node:fs";
import path from "node:path";

/**
 * Finding the real file behind a command name on Windows.
 *
 * `spawn("npx")` cannot see through `PATHEXT`, so the executable that actually
 * has to be launched is `npx.cmd`; the same is true for `pwsh` vs `pwsh.exe`.
 * Node does resolve `PATH` itself, but only for the exact name it is given, so
 * anything that comes from a setting has to be resolved here first.
 */

/** Environment variables are not guaranteed to be set; these are the Windows defaults. */
const DEFAULT_EXTS = [".COM", ".EXE", ".BAT", ".CMD"];

/** Extensions searched for a bare command name, in order (`PATHEXT` when set). */
export function executableExtensions(): string[] {
  const raw = process.env.PATHEXT;
  const list = (raw ?? DEFAULT_EXTS.join(";")).split(";").map((x) => x.trim()).filter(Boolean);
  return list.length > 0 ? list : DEFAULT_EXTS;
}

/**
 * Find the real path of a command. An absolute path or anything containing a
 * separator is returned unchanged (`spawn` handles those itself); a bare name is
 * looked up on `PATH` with every `PATHEXT` extension. When nothing is found the
 * original name is returned, so the caller still sees a useful ENOENT message.
 */
export function resolveCommand(command: string, extraDirs: string[] = []): string {
  if (!command) return command;
  if (path.isAbsolute(command) || /[\\/]/.test(command)) return command;
  const dirs = [
    ...extraDirs,
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
  ];
  for (const dir of dirs) {
    // Windows resolves a bare name with PATHEXT, not by trying the literal name:
    // trying "" first finds npm's POSIX shell script before npm.cmd, and spawning
    // that fails with EINVAL. A file that really has no extension is still found
    // last, so nothing that used to resolve stops resolving.
    const extensions =
      process.platform === "win32" ? [...executableExtensions(), ""] : ["", ...executableExtensions()];
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // unreadable PATH entry - keep looking
      }
    }
  }
  return command;
}
