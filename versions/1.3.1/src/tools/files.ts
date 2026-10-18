import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
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

function resolvePath(value: string): string {
  return path.resolve(process.cwd(), value);
}

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
        "delete, mkdir, search (by name), grep (by content), hash, zip, unzip.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          path: { type: "string", description: "Primary file or folder path." },
          source: { type: "string", description: "Source path for copy/move." },
          destination: { type: "string", description: "Destination path or zip archive." },
          content: { type: "string", description: "Text to write or append." },
          find: { type: "string", description: "edit: exact existing text to locate." },
          replace: { type: "string", description: "edit: text to put in its place." },
          all: { type: "boolean", description: "edit: replace every occurrence, not just the first." },
          offset: { type: "number", description: "read: skip this many characters first." },
          pattern: { type: "string", description: "Wildcard (search) or regex (grep)." },
          overwrite: { type: "boolean", description: "Allow replacing existing files." },
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
        const dir = resolvePath(argOpt(args, "path") ?? ".");
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
        const dir = resolvePath(argOpt(args, "path") ?? ".");
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
        const target = resolvePath(arg(args, "path"));
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
        const target = resolvePath(arg(args, "path"));
        const content = argOpt(args, "content") ?? "";
        const overwrite = argBool(args, "overwrite", false);
        const existing = await statSafe(target);
        if (existing && !overwrite) {
          return `Refused: ${target} already exists. Pass overwrite=true to replace it.`;
        }
        if (ctx.dryRun) return `DRY RUN: would write ${content.length} chars to ${target}`;
        await fs.mkdir(path.dirname(target), { recursive: true });
        // Overwriting a file that Windows wrote as UTF-16 keeps it UTF-16.
        const previous = existing ? await readText(target).catch(() => null) : null;
        await writeTextLike(target, content, previous);
        return `Wrote ${content.length} characters to ${target}`;
      }

      case "append": {
        const target = resolvePath(arg(args, "path"));
        const content = argOpt(args, "content") ?? "";
        if (ctx.dryRun) return `DRY RUN: would append ${content.length} chars to ${target}`;
        await fs.mkdir(path.dirname(target), { recursive: true });
        // Appending bytes to a UTF-16 file in UTF-8 would corrupt it, so read the
        // existing text and rewrite the whole file in its own encoding.
        const existing = await readText(target).catch(() => null);
        if (existing) await writeTextLike(target, existing.text + content, existing);
        else await fs.appendFile(target, encodeText(content, "utf8", false));
        return `Appended ${content.length} characters to ${target}`;
      }

      case "edit": {
        const target = resolvePath(arg(args, "path"));
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
        await writeTextLike(target, updated, file);
        const leftover =
          occurrences > replaced
            ? `\nnote: ${occurrences} occurrences existed, only ${replaced} replaced — pass all=true to replace every one`
            : "";
        return `Edited ${target}: replaced ${replaced} occurrence(s)${leftover}\n${diffPreview(original, updated)}`;
      }

      case "copy": {
        const source = resolvePath(arg(args, "source"));
        const destination = resolvePath(arg(args, "destination"));
        if (ctx.dryRun) return `DRY RUN: would copy ${source} -> ${destination}`;
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.cp(source, destination, { recursive: true, force: argBool(args, "overwrite", false) });
        return `Copied ${source} -> ${destination}`;
      }

      case "move": {
        const source = resolvePath(arg(args, "source"));
        const destination = resolvePath(arg(args, "destination"));
        if (!(await ctx.approve(`move/rename ${source} -> ${destination}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would move ${source} -> ${destination}`;
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.rename(source, destination).catch(async (error: NodeJS.ErrnoException) => {
          if (error.code === "EXDEV") {
            await fs.cp(source, destination, { recursive: true });
            await fs.rm(source, { recursive: true, force: true });
          } else {
            throw error;
          }
        });
        return `Moved ${source} -> ${destination}`;
      }

      case "delete": {
        const target = resolvePath(arg(args, "path"));
        const recursive = argBool(args, "recursive", false);
        if (!(await ctx.approve(`permanently delete ${target}${recursive ? " (recursive)" : ""}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would delete ${target}`;
        await fs.rm(target, { recursive, force: true });
        return `Deleted ${target}`;
      }

      case "mkdir": {
        const target = resolvePath(arg(args, "path"));
        if (ctx.dryRun) return `DRY RUN: would create folder ${target}`;
        await fs.mkdir(target, { recursive: true });
        return `Created folder ${target}`;
      }

      case "search": {
        const dir = resolvePath(argOpt(args, "path") ?? ".");
        const pattern = argOpt(args, "pattern") ?? "*";
        const depth = argNum(args, "depth", 5);
        const max = argNum(args, "max", 100);
        const regex = new RegExp(
          "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
          "i",
        );
        const items = await walk(dir, depth, 5_000);
        const matches = items.filter((i) => regex.test(path.basename(i.rel)));
        if (matches.length === 0) return `No files matching "${pattern}" under ${dir}`;
        return matches
          .slice(0, max)
          .map((m) => path.join(dir, m.rel))
          .join("\n");
      }

      case "grep": {
        const dir = resolvePath(argOpt(args, "path") ?? ".");
        const pattern = arg(args, "pattern");
        const max = argNum(args, "max", 50);
        const regex = new RegExp(pattern, "i");
        const items = await walk(dir, argNum(args, "depth", 5), 5_000);
        const hits: string[] = [];
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
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              hits.push(`${item.rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              if (hits.length >= max) break;
            }
          }
        }
        return hits.length === 0 ? `No matches for "${pattern}" under ${dir}` : hits.join("\n");
      }

      case "hash": {
        const target = resolvePath(arg(args, "path"));
        const algorithm = argEnum(args, "algorithm", ["sha256", "sha1", "md5"] as const);
        const data = await fs.readFile(target);
        return `${algorithm.toUpperCase()} ${createHash(algorithm).update(data).digest("hex")}  ${target}`;
      }

      case "zip": {
        const source = resolvePath(arg(args, "source"));
        const destination = resolvePath(arg(args, "destination"));
        if (ctx.dryRun) return `DRY RUN: would zip ${source} -> ${destination}`;
        await runPs(
          `Compress-Archive -LiteralPath ${psQuote(source)} -DestinationPath ${psQuote(destination)} -Force`,
        );
        return `Created archive ${destination}`;
      }

      case "unzip": {
        const source = resolvePath(arg(args, "source"));
        const destination = resolvePath(argOpt(args, "destination") ?? ".");
        if (ctx.dryRun) return `DRY RUN: would extract ${source} -> ${destination}`;
        await runPs(
          `Expand-Archive -LiteralPath ${psQuote(source)} -DestinationPath ${psQuote(destination)} -Force`,
        );
        return `Extracted ${source} -> ${destination}`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
