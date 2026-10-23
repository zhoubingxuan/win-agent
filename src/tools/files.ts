import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { jailPath } from "../sandbox.js";
import { psQuote, runPs } from "../util/ps.js";
import { decodeText, encodeText, type DecodedText } from "../util/text.js";
import { arg, argBool, argEnum, argNum, argOpt, type Tool } from "./registry.js";

const ACTIONS = [
  "list",
  "tree",
  "read",
  "write",
  "append",
  "edit",
  "copy",
  "move",
  "delete",
  "mkdir",
  "search",
  "grep",
  "hash",
  "zip",
  "unzip",
] as const;

async function statSafe(target: string): Promise<{ size: number; mtime: string } | null> {
  try {
    const st = await fs.stat(target);
    return { size: st.size, mtime: st.mtime.toISOString() };
  } catch {
    return null;
  }
}

/**
 * Read a text file the way Windows wrote it (UTF-8, or UTF-16 with a BOM - see
 * util/text.ts) and remember the encoding, so an edit can write it back the same
 * way. Notepad's "Unicode", PowerShell 5.1's `Out-File` and most Windows tools
 * still produce UTF-16, and reading those as UTF-8 gives `h\0e\0l\0l\0o`.
 */
async function readText(target: string): Promise<DecodedText> {
  return decodeText(await fs.readFile(target));
}

/** Write text back in the encoding the file already had (UTF-8 for new files). */
async function writeTextLike(target: string, text: string, like: DecodedText | null): Promise<void> {
  const encoding = like?.encoding ?? "utf8";
  const withBom = like?.bom != null;
  await fs.writeFile(target, encodeText(text, encoding, withBom));
}

/**
 * A small model's favourite archive mistake: `{"action":"zip","path":"...","destination":"..."}`.
 * Saying exactly which two arguments to use, and that `path` is not one of them,
 * ends the loop faster than "missing required string argument".
 */
function archiveArgError(args: Record<string, unknown>, action: "zip" | "unzip", needDestination: boolean): string | null {
  const source = (argOpt(args, "source") ?? "").trim();
  const destination = (argOpt(args, "destination") ?? "").trim();
  if (source && (!needDestination || destination)) return null;
  const how =
    action === "zip"
      ? 'source = the folder to zip, destination = the .zip to create'
      : 'source = the .zip, destination = the folder to extract into (optional, default ".")';
  const usedPath = (argOpt(args, "path") ?? "").trim() !== "";
  return `Error: ${action} needs ${how}.${usedPath ? ' "path" is not used by this action.' : ""}`;
}

/** The first non-empty line, shortened: a receipt that shows what was replaced. */
function previewText(text: string, max = 60): string {
  const first = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  return first.length > max ? `${first.slice(0, max)}...` : first;
}

/** A short unified-style diff of the changed lines, for the edit action. */
function diffPreview(before: string, after: string, limit = 20): string {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const lines: string[] = [];
  const context = 1;
  for (let i = Math.max(0, start - context); i < start; i++) lines.push(`  ${a[i]}`);
  for (let i = start; i <= endA; i++) lines.push(`- ${a[i]}`.slice(0, 200));
  for (let i = start; i <= endB; i++) lines.push(`+ ${b[i]}`.slice(0, 200));
  if (lines.length > limit) {
    lines.length = limit;
    lines.push(`... (diff truncated; ${endA - start + 1} line(s) removed, ${endB - start + 1} added)`);
  }
  return lines.join("\n");
}

async function walk(
  root: string,
  maxDepth: number,
  maxEntries: number,
): Promise<Array<{ rel: string; dir: boolean; size: number }>> {
  const results: Array<{ rel: string; dir: boolean; size: number }> = [];

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || results.length >= maxEntries) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) {
        results.push({ rel, dir: true, size: 0 });
        await visit(full, depth + 1);
      } else {
        const st = await statSafe(full);
        results.push({ rel, dir: false, size: st?.size ?? 0 });
      }
    }
  }

  await visit(root, 1);
  return results;
}

export const filesTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "files",
      description:
        "Create, read, search and manage files and folders on this Windows machine. " +
        "actions: list, tree, read, write, append, edit (replace exact text), copy, move, " +
        "delete, mkdir, search (by name), grep (by content), hash, " +
        "zip (source folder -> destination .zip), unzip (source .zip -> destination folder).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          path: { type: "string", description: "Primary file or folder path (list, tree, read, write, edit, delete, mkdir, search, grep, hash)." },
          source: { type: "string", description: "copy/move/zip/unzip: the source file, folder, or .zip." },
          destination: { type: "string", description: "copy/move/zip/unzip: the destination; for zip, the .zip to create; for unzip, the folder to extract into." },
          content: { type: "string", description: "Text to write or append." },
          find: { type: "string", description: "edit: exact existing text to locate." },
          replace: { type: "string", description: "edit: text to put in its place." },
          all: { type: "boolean", description: "edit: replace every occurrence, not just the first." },
          offset: { type: "number", description: "read: skip this many characters first." },
          pattern: { type: "string", description: "Wildcard (search) or regex (grep)." },
          overwrite: { type: "boolean", description: "Allow replacing an existing file (together with expected)." },
          expected: {
            type: "string",
            description:
              "write: when replacing an existing file, a piece of its current text (at least 4 characters, " +
              "or all of it when shorter) - read the file first. The write is refused if that text is not there.",
          },
          recursive: { type: "boolean", description: "Recurse into subfolders for delete." },
          depth: { type: "number", description: "Max depth for tree/search. Default 3." },
          max: { type: "number", description: "Max results to return. Default 100." },
          algorithm: { type: "string", enum: ["sha256", "sha1", "md5"] },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = argEnum(args, "action", ACTIONS);

    switch (action) {
      case "list": {
        const dir = jailPath(argOpt(args, "path") ?? ".");
        const entries = await fs.readdir(dir, { withFileTypes: true });
        if (entries.length === 0) return `(empty folder) ${dir}`;
        const lines: string[] = [`Contents of ${dir}:`];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            lines.push(`[dir ] ${entry.name}`);
          } else {
            const st = await statSafe(path.join(dir, entry.name));
            lines.push(`[file] ${String(st?.size ?? 0).padStart(10)}  ${entry.name}`);
          }
        }
        return lines.join("\n");
      }

      case "tree": {
        const dir = jailPath(argOpt(args, "path") ?? ".");
        const depth = argNum(args, "depth", 3);
        const max = argNum(args, "max", 200);
        const items = await walk(dir, depth, max);
        if (items.length === 0) return `(empty folder) ${dir}`;
        const lines = [`${dir}`];
        for (const item of items) {
          const indent = "  ".repeat(item.rel.split(/[\\/]/).length - 1);
          lines.push(`${indent}${item.dir ? "[dir ] " : "[file] "}${path.basename(item.rel)}`);
        }
        if (items.length >= max) lines.push(`... (truncated at ${max} entries)`);
        return lines.join("\n");
      }

      case "read": {
        const target = jailPath(arg(args, "path"));
        const file = await readText(target);
        if (file.binary) {
          const size = (await statSafe(target))?.size ?? 0;
          return `Refused: ${target} looks like a binary file (${size} bytes), so printing it would only produce noise. Use "hash" or "list" instead.`;
        }
        const content = file.text;
        const offset = Math.max(argNum(args, "offset", 0), 0);
        const max = argNum(args, "max", 20_000);
        const slice = content.slice(offset, offset + max);
        return content.length > offset + max
          ? `${slice}\n... (truncated, chars ${offset}-${offset + max} of ${content.length})`
          : slice;
      }

      case "write": {
        const target = jailPath(arg(args, "path"));
        const content = argOpt(args, "content") ?? "";
        const overwrite = argBool(args, "overwrite", false);
        const expected = (argOpt(args, "expected") ?? "").trim();
        const existing = await statSafe(target);
        if (existing && !overwrite) {
          return (
            `Refused: ${target} already exists. Read it first, then change it with action "edit" ` +
            `(or apply_patch); to replace the whole file, pass overwrite=true and expected with a ` +
            `piece of the current text.`
          );
        }
        // Overwriting a file that Windows wrote as UTF-16 keeps it UTF-16.
        const previous = existing ? await readText(target).catch(() => null) : null;
        if (existing && overwrite && previous && previous.text.trim() !== "") {
          // "overwrite": true alone is how a model destroys a file it never read.
          // Requiring a piece of the current text turns that into a step it has to
          // look at (and makes a wrong guess a refusal, not a loss).
          if (expected.length < 4 && expected !== previous.text.trim()) {
            return (
              `Refused: ${target} already has content. Read it first and pass expected with a piece ` +
              `of the current text (at least 4 characters, or the whole text if it is shorter) if you ` +
              `really mean to replace the whole file - or use action "edit" to change just the part ` +
              `that should change.`
            );
          }
          if (!previous.text.includes(expected)) {
            return (
              `Refused: ${JSON.stringify(expected)} is not in ${target}. ` +
              `Read the file and pass a piece of what it actually contains - or use action "edit".`
            );
          }
        }
        if (ctx.dryRun) return `DRY RUN: would write ${content.length} chars to ${target}`;
        // Save the old version before touching it: /undo puts this back.
        const backup = existing ? await ctx.backup(target) : null;
        await fs.mkdir(path.dirname(target), { recursive: true });
        await writeTextLike(target, content, previous);
        ctx.record({
          action: "write",
          summary: `wrote ${content.length} characters to ${target}`,
          paths: [target],
          steps: !existing
            ? [{ kind: "remove", path: target }]
            : backup
              ? [{ kind: "restore", path: target, backup }]
              : [],
        });
        // Say what was replaced: a model that "wrote" a file it never read has
        // just destroyed something, and the receipt is where it can notice.
        if (!existing) return `Wrote ${content.length} characters to ${target} (new file)`;
        const oldLength = previous ? previous.text.length : null;
        const oldStart = previous ? previewText(previous.text) : "";
        const detail =
          oldLength === null
            ? "replaced existing content (it could not be read back as text)"
            : `replaced ${oldLength} characters${oldStart ? `; the old text began ${JSON.stringify(oldStart)}` : ""}`;
        return `Wrote ${content.length} characters to ${target} (${detail})`;
      }

      case "append": {
        const target = jailPath(arg(args, "path"));
        const content = argOpt(args, "content") ?? "";
        if (ctx.dryRun) return `DRY RUN: would append ${content.length} chars to ${target}`;
        const existed = (await statSafe(target)) !== null;
        const backup = existed ? await ctx.backup(target) : null;
        await fs.mkdir(path.dirname(target), { recursive: true });
        // Appending bytes to a UTF-16 file in UTF-8 would corrupt it, so read the
        // existing text and rewrite the whole file in its own encoding.
        const existing = await readText(target).catch(() => null);
        if (existing) await writeTextLike(target, existing.text + content, existing);
        else await fs.appendFile(target, encodeText(content, "utf8", false));
        ctx.record({
          action: "append",
          summary: `appended ${content.length} characters to ${target}`,
          paths: [target],
          steps: !existed
            ? [{ kind: "remove", path: target }]
            : backup
              ? [{ kind: "restore", path: target, backup }]
              : [],
        });
        return existing
          ? `Appended ${content.length} characters to ${target} (the file had ${existing.text.length})`
          : `Appended ${content.length} characters to ${target} (created the file)`;
      }

      case "edit": {
        const target = jailPath(arg(args, "path"));
        const find = arg(args, "find");
        const replace = argOpt(args, "replace") ?? "";
        const all = argBool(args, "all", false);
        const file = await readText(target);
        const original = file.text;

        const at = original.indexOf(find);
        if (at < 0) {
          const preview = find.length > 80 ? `${find.slice(0, 80)}...` : find;
          return `Refused: that text is not in ${target}. Looked for: ${JSON.stringify(preview)}`;
        }
        const occurrences = original.split(find).length - 1;
        const replaced = all ? occurrences : 1;
        const updated = all
          ? original.split(find).join(replace)
          : original.slice(0, at) + replace + original.slice(at + find.length);

        if (ctx.dryRun) {
          return `DRY RUN: would replace ${replaced} occurrence(s) in ${target}\n${diffPreview(original, updated)}`;
        }
        const backup = await ctx.backup(target);
        await writeTextLike(target, updated, file);
        ctx.record({
          action: "edit",
          summary: `replaced ${replaced} occurrence(s) in ${target}`,
          paths: [target],
          steps: backup ? [{ kind: "restore", path: target, backup }] : [],
        });
        const leftover =
          occurrences > replaced
            ? `\nnote: ${occurrences} occurrences existed, only ${replaced} replaced — pass all=true to replace every one`
            : "";
        return `Edited ${target}: replaced ${replaced} occurrence(s)${leftover}\n${diffPreview(original, updated)}`;
      }

      case "copy": {
        const source = jailPath(arg(args, "source"));
        const destination = jailPath(arg(args, "destination"));
        if (ctx.dryRun) return `DRY RUN: would copy ${source} -> ${destination}`;
        // Only a copy that created something new can be undone: overwriting an
        // existing folder would need a copy of the whole folder to restore.
        const existed = (await statSafe(destination)) !== null;
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.cp(source, destination, { recursive: true, force: argBool(args, "overwrite", false) });
        ctx.record({
          action: "copy",
          summary: `copied ${source} -> ${destination}`,
          paths: [source, destination],
          steps: existed ? [] : [{ kind: "remove", path: destination }],
        });
        return `Copied ${source} -> ${destination}`;
      }

      case "move": {
        const source = jailPath(arg(args, "source"));
        const destination = jailPath(arg(args, "destination"));
        if (!(await ctx.approve(`move/rename ${source} -> ${destination}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would move ${source} -> ${destination}`;
        // Moving onto an existing file replaces it without a word, so keep a copy
        // of what was there: otherwise "undo" would put the source back and leave
        // the replaced file gone for good.
        const replaced = (await statSafe(destination)) !== null ? await ctx.backup(destination) : null;
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.rename(source, destination).catch(async (error: NodeJS.ErrnoException) => {
          if (error.code === "EXDEV") {
            await fs.cp(source, destination, { recursive: true });
            await fs.rm(source, { recursive: true, force: true });
          } else {
            throw error;
          }
        });
        ctx.record({
          action: "move",
          summary: `moved ${source} -> ${destination}`,
          paths: [source, destination],
          // Steps run in reverse (see src/audit.ts), so the file moves back first
          // and only then is the replaced destination restored.
          steps: [
            ...(replaced ? [{ kind: "restore" as const, path: destination, backup: replaced }] : []),
            { kind: "move", from: destination, to: source },
          ],
        });
        return `Moved ${source} -> ${destination}`;
      }

      case "delete": {
        const target = jailPath(arg(args, "path"));
        const recursive = argBool(args, "recursive", false);
        if (!(await ctx.approve(`permanently delete ${target}${recursive ? " (recursive)" : ""}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would delete ${target}`;
        // A deleted file or folder is the one thing users ask for back, so keep a
        // copy until either /undo is used or the next run sweeps the folder.
        const backup = await ctx.backup(target);
        await fs.rm(target, { recursive, force: true });
        ctx.record({
          action: "delete",
          summary: `deleted ${target}${recursive ? " (recursive)" : ""}`,
          paths: [target],
          steps: backup ? [{ kind: "restore", path: target, backup }] : [],
        });
        return `Deleted ${target}${backup ? "" : " (not undoable: too large to copy aside)"}`;
      }

      case "mkdir": {
        const target = jailPath(arg(args, "path"));
        if (ctx.dryRun) return `DRY RUN: would create folder ${target}`;
        const existed = (await statSafe(target)) !== null;
        await fs.mkdir(target, { recursive: true });
        ctx.record({
          action: "mkdir",
          summary: `created folder ${target}`,
          paths: [target],
          // Undo removes the folder only if it is still empty, and only when this
          // call was what created it.
          steps: existed ? [] : [{ kind: "rmdir", path: target }],
        });
        return `Created folder ${target}`;
      }

      case "search": {
        const dir = jailPath(argOpt(args, "path") ?? ".");
        const pattern = argOpt(args, "pattern") ?? "*";
        const depth = argNum(args, "depth", 5);
        const max = argNum(args, "max", 100);
        const regex = new RegExp(
          "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
          "i",
        );
        const items = await walk(dir, depth, 5_000);
        const matches = items.filter((i) => regex.test(path.basename(i.rel)));
        if (matches.length === 0) {
          return (
            `No file *names* match "${pattern}" under ${dir} (searched ${items.length} entries).\n` +
            'This searches names only - to search inside files, use action "grep".'
          );
        }
        return matches
          .slice(0, max)
          .map((m) => path.join(dir, m.rel))
          .join("\n");
      }

      case "grep": {
        const dir = jailPath(argOpt(args, "path") ?? ".");
        const pattern = arg(args, "pattern");
        const max = argNum(args, "max", 50);
        const regex = new RegExp(pattern, "i");
        const items = await walk(dir, argNum(args, "depth", 5), 5_000);
        const hits: string[] = [];
        let scanned = 0;
        for (const item of items) {
          if (item.dir || hits.length >= max) continue;
          if (item.size > 1_000_000) continue;
          let text: string;
          try {
            // UTF-16 (a very common Windows encoding) would look like binary
            // noise if it were read as UTF-8; decode it properly, and skip
            // anything that is not text at all.
            const file = decodeText(await fs.readFile(path.join(dir, item.rel)));
            if (file.binary) continue;
            text = file.text;
          } catch {
            continue;
          }
          scanned += 1;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              hits.push(`${item.rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              if (hits.length >= max) break;
            }
          }
        }
        return hits.length === 0
          ? `No matches for "${pattern}" in ${scanned} text file(s) under ${dir}` +
              ` (file contents were searched, as a regular expression, case-insensitive).`
          : hits.join("\n");
      }

      case "hash": {
        const target = jailPath(arg(args, "path"));
        const algorithm = argEnum(args, "algorithm", ["sha256", "sha1", "md5"] as const);
        const data = await fs.readFile(target);
        return `${algorithm.toUpperCase()} ${createHash(algorithm).update(data).digest("hex")}  ${target}`;
      }

      case "zip": {
        const bad = archiveArgError(args, "zip", true);
        if (bad) return bad;
        const source = jailPath(arg(args, "source"));
        const destination = jailPath(arg(args, "destination"));
        if (ctx.dryRun) return `DRY RUN: would zip ${source} -> ${destination}`;
        await runPs(
          `Compress-Archive -LiteralPath ${psQuote(source)} -DestinationPath ${psQuote(destination)} -Force`,
        );
        ctx.record({
          action: "zip",
          summary: `created archive ${destination}`,
          paths: [destination],
        });
        return `Created archive ${destination}`;
      }

      case "unzip": {
        const bad = archiveArgError(args, "unzip", false);
        if (bad) return bad;
        const source = jailPath(arg(args, "source"));
        const destination = jailPath(argOpt(args, "destination") ?? ".");
        if (ctx.dryRun) return `DRY RUN: would extract ${source} -> ${destination}`;
        await runPs(
          `Expand-Archive -LiteralPath ${psQuote(source)} -DestinationPath ${psQuote(destination)} -Force`,
        );
        // Extraction can overwrite any number of files in an existing folder, so
        // there is nothing small enough to snapshot: logged, not undoable.
        ctx.record({
          action: "unzip",
          summary: `extracted ${source} -> ${destination}`,
          paths: [destination],
        });
        return `Extracted ${source} -> ${destination}`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
