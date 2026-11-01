/**
 * Unified-diff patches, without a dependency and without surprises.
 *
 * A small model that rewrites a whole file has to reproduce every line it did not
 * mean to change; it will not. A patch says only what changes, and this module
 * refuses the whole thing when the context does not match - so a wrong patch is a
 * message, not a half-edited file.
 *
 * The format understood here is the one `git diff` prints: `---`/`+++` headers,
 * `@@ -old,count +new,count @@` hunks, and ` `/`-`/`+` lines. A missing count means
 * one line, a hunk may sit a few lines away from where the numbers claim (files get
 * edited between writing a patch and applying it), and `\ No newline at end of
 * file` is accepted and ignored.
 */

export type PatchLineKind = " " | "-" | "+";

export interface PatchLine {
  kind: PatchLineKind;
  text: string;
}

export interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: PatchLine[];
}

export interface PatchFile {
  /** Target path, without the `a/` / `b/` prefix. */
  path: string;
  hunks: PatchHunk[];
  /** `--- /dev/null`: the file is created. */
  create: boolean;
  /** `+++ /dev/null`: the file is deleted (the tool refuses these for now). */
  delete: boolean;
}

export interface ParsedPatch {
  files: PatchFile[];
  errors: string[];
}

/** A file that changed, and how. */
export interface AppliedFile {
  path: string;
  hunks: number;
  added: number;
  removed: number;
  /** Lines a preview prints: the `-`/`+` lines of every hunk, capped by the caller. */
  preview: string[];
}

export interface ApplyResult {
  ok: boolean;
  text?: string;
  applied: number;
  added: number;
  removed: number;
  error?: string;
  details: string[];
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

export function parsePatch(raw: string): ParsedPatch {
  const errors: string[] = [];
  const files: PatchFile[] = [];
  const normalized = String(raw ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // One final newline is the end of the text, not an empty context line.
  const lines = (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");

  let current: PatchFile | null = null;
  let hunk: PatchHunk | null = null;

  const finishHunk = () => {
    if (hunk && current) current.hunks.push(hunk);
    hunk = null;
  };
  const finishFile = () => {
    finishHunk();
    if (current) files.push(current);
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("diff --git ")) {
      finishFile();
      continue;
    }

    if (line.startsWith("--- ")) {
      const minus = line.slice(4).trim();
      const next = lines[index + 1] ?? "";
      if (!next.startsWith("+++ ")) {
        errors.push(`line ${index + 1}: a "---" header is not followed by "+++"`);
        continue;
      }
      finishFile();
      const plus = next.slice(4).trim();
      const oldPath = headerPath(minus);
      const newPath = headerPath(plus);
      current = {
        path: newPath || oldPath,
        create: oldPath === "/dev/null",
        delete: newPath === "/dev/null",
        hunks: [],
      };
      index += 1;
      continue;
    }

    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (!current) {
        errors.push(`line ${index + 1}: a hunk appears before any "---"/"+++" file header`);
        continue;
      }
      finishHunk();
      hunk = {
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      continue;
    }

    if (!hunk) continue; // `index`, `new file mode`, `similarity index`, ...
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line === "") {
      // Some editors drop the leading space of an empty context line.
      hunk.lines.push({ kind: " ", text: "" });
      continue;
    }

    const kind = line[0];
    if (kind === " " || kind === "+" || kind === "-") {
      hunk.lines.push({ kind, text: line.slice(1) });
      continue;
    }
    errors.push(`line ${index + 1}: not a patch line: ${line.slice(0, 60)}`);
  }

  finishFile();

  if (files.length === 0) errors.push("the patch has no file headers (--- / +++ lines)");
  for (const file of files) {
    if (!file.path) errors.push("a file header has an empty path");
    if (file.hunks.length === 0 && !file.create && !file.delete) errors.push(`${file.path}: no @@ hunks`);
  }
  return { files, errors };
}

/** `a/src/x.ts\t2026-...` -> `src/x.ts`; also strips quotes and backslashes. */
function headerPath(value: string): string {
  let text = value.split("\t")[0].trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  text = text.replace(/\\/g, "/");
  if (text.startsWith("a/") || text.startsWith("b/")) text = text.slice(2);
  return text;
}

/* -------------------------------------------------------------------------- */
/* Applying                                                                    */
/* -------------------------------------------------------------------------- */

export function applyFilePatch(original: string, file: PatchFile): ApplyResult {
  if (file.delete) {
    return { ok: false, applied: 0, added: 0, removed: 0, details: [], error: "deleting files through a patch is not supported; use the files tool with action delete" };
  }
  if (file.create && original !== "") {
    return { ok: false, applied: 0, added: 0, removed: 0, details: [], error: `${file.path} already exists; patch it instead of creating it` };
  }

  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = original === "" || original.endsWith("\n");
  let lines = original === "" ? [] : original.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

  let offset = 0;
  let applied = 0;
  const details: string[] = [];

  for (let index = 0; index < file.hunks.length; index += 1) {
    const hunk = file.hunks[index];
    const oldLines = hunk.lines.filter((line) => line.kind !== "+").map((line) => line.text);
    const newLines = hunk.lines.filter((line) => line.kind !== "-").map((line) => line.text);
    const claimed = Math.max(0, hunk.oldStart - 1) + offset;

    let at: number;
    if (oldLines.length === 0) {
      // A pure insertion: `@@ -0,0 +1,2 @@` is the top, `@@ -3,0 +4,2 @@` after line 3.
      at = Math.min(lines.length, Math.max(0, hunk.oldStart + offset));
    } else {
      at = findNearest(lines, oldLines, claimed);
      if (at < 0) {
        const everywhere = findAll(lines, oldLines);
        if (everywhere.length === 1) {
          at = everywhere[0];
        } else if (everywhere.length > 1) {
          return {
            ok: false,
            applied,
            added: 0,
            removed: 0,
            details,
            error:
              `hunk ${index + 1}: the context appears ${everywhere.length} times (lines ` +
              `${everywhere.map((line) => line + 1).join(", ")}); add a line that makes it unique`,
          };
        } else {
          return {
            ok: false,
            applied,
            added: 0,
            removed: 0,
            details,
            error:
              `hunk ${index + 1}: context does not match (wanted ${JSON.stringify(oldLines[0] ?? "")} ` +
              `near line ${hunk.oldStart}); nothing was written`,
          };
        }
      }
    }

    lines = [...lines.slice(0, at), ...newLines, ...lines.slice(at + oldLines.length)];
    offset += newLines.length - oldLines.length;
    applied += 1;
    details.push(`hunk ${index + 1}: ${oldLines.length} line(s) at ${hunk.oldStart} -> ${newLines.length} line(s)`);
  }

  let text = lines.join(eol);
  if (text !== "" && hadFinalNewline) text += eol;
  if (original === "" && text !== "" && !text.endsWith(eol)) text += eol;

  // The +/- counts come from the patch itself, not from a line diff.
  return { ok: true, text, applied, added: countKind(file, "+"), removed: countKind(file, "-"), details };
}

function countKind(file: PatchFile, kind: PatchLineKind): number {
  return file.hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === kind).length,
    0,
  );
}

/** Exact match at `start`, then the closest match within a small window. */
function findNearest(lines: string[], pattern: string[], start: number): number {
  const maxDistance = 200;
  for (let distance = 0; distance <= maxDistance; distance += 1) {
    const candidates = distance === 0 ? [start] : [start - distance, start + distance];
    for (const at of candidates) {
      if (at < 0 || at + pattern.length > lines.length) continue;
      if (pattern.every((line, index) => lines[at + index] === line)) return at;
    }
  }
  return -1;
}

function findAll(lines: string[], pattern: string[]): number[] {
  const found: number[] = [];
  for (let at = 0; at + pattern.length <= lines.length; at += 1) {
    if (pattern.every((line, index) => lines[at + index] === line)) found.push(at);
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                   */
/* -------------------------------------------------------------------------- */

/** The `-`/`+` lines of a hunk, prefixed, for the tool result and the preview. */
export function hunkPreview(file: PatchFile, maxLines = 24): string[] {
  const out: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === " ") continue;
      out.push(`${line.kind} ${line.text}`.trimEnd());
      if (out.length >= maxLines) {
        out.push("... (more changed lines, see the file card)");
        return out;
      }
    }
  }
  return out;
}

/** What the model is told after a successful apply. */
export function describeApplied(file: AppliedFile): string {
  return `${file.path}: ${file.hunks} hunk(s), +${file.added} -${file.removed}`;
}
