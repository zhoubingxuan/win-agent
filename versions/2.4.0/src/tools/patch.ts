import fs from "node:fs/promises";
import path from "node:path";
import { argOpt, type Tool } from "./registry.js";
import { jailPath } from "../sandbox.js";
import { applyFilePatch, hunkPreview, parsePatch, type AppliedFile, type PatchFile } from "../patch.js";
import { decodeText, encodeText } from "../util/text.js";

const MAX_PATCH_CHARS = 200_000;
const MAX_FILES = 20;
const PREVIEW_LINES = 24;

/**
 * Change existing files with a unified diff.
 *
 * This is the difference between "edit code" and "rewrite code": the model writes
 * only the lines that change, and every hunk has to match the file it claims to
 * change. A patch that does not match is refused as a whole - no file is touched -
 * and a patch that does is backed up, recorded and undoable like any other write.
 */
export const applyPatchTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Change one or more existing files with a unified diff (the format `git diff` prints). " +
        "Only the lines in the patch change; if any hunk does not match, nothing is written. " +
        "Use this instead of rewriting a whole file when you are editing code. " +
        'Set action to "preview" to see the result without writing. Create files with the files tool.',
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["apply", "preview"],
            description: 'apply = write the changes, preview = check them and change nothing.',
          },
          patch: {
            type: "string",
            description:
              "The diff: --- a/path\\n+++ b/path\\n@@ -1,3 +1,3 @@ with context, - removed and + added lines.",
          },
          path: {
            type: "string",
            description:
              "Only when the patch has no ---/+++ headers: the single file to patch.",
          },
        },
        required: ["patch"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const raw = argPatch(args);
    if (!raw.trim()) return "Error: the patch is empty.";
    if (raw.length > MAX_PATCH_CHARS) {
      return `Error: the patch is ${raw.length} characters, the limit is ${MAX_PATCH_CHARS}. Split it.`;
    }

    const single = argOpt(args, "path")?.trim();
    const text =
      single && !/^--- /m.test(raw)
        ? `--- a/${single.replace(/\\/g, "/")}\n+++ b/${single.replace(/\\/g, "/")}\n${raw}`
        : raw;

    const parsed = parsePatch(text);
    if (parsed.errors.length > 0) {
      return `Error: the patch could not be read.\n${parsed.errors.slice(0, 6).map((line) => `- ${line}`).join("\n")}`;
    }
    if (parsed.files.length > MAX_FILES) {
      return `Error: the patch touches ${parsed.files.length} files, the limit is ${MAX_FILES}. Split it.`;
    }
    if (parsed.files.some((file) => file.delete)) {
      return "Error: deleting a file through a patch is not supported. Use files with action delete.";
    }

    const action = (argOpt(args, "action") ?? "apply").trim().toLowerCase();
    const previewOnly = action === "preview" || action === "check" || action === "dry-run" || ctx.dryRun;
    if (!["apply", "preview", "check", "dry-run", "dryrun"].includes(action)) {
      return `Error: unknown action "${action}". Use "apply" or "preview".`;
    }

    // Read and patch everything in memory first: one bad hunk means no writes at all.
    const prepared: {
      file: PatchFile;
      target: string;
      before: string;
      after: string;
      result: AppliedFile;
      encoding: "utf8" | "utf16le" | "utf16be";
      bom: boolean;
    }[] = [];

    for (const file of parsed.files) {
      const target = jailPath(file.path);
      let before = "";
      let encoding: "utf8" | "utf16le" | "utf16be" = "utf8";
      let bom = false;
      let exists = true;
      try {
        const buffer = await fs.readFile(target);
        const decoded = decodeText(buffer);
        if (decoded.binary) return `Error: ${file.path} looks like a binary file; it cannot be patched.`;
        before = decoded.text;
        encoding = decoded.encoding;
        bom = decoded.bom != null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        exists = false;
      }
      if (!exists && !file.create) {
        return `Error: ${file.path} does not exist. Create it with the files tool (action write), then patch it.`;
      }
      if (exists && file.create) {
        return `Error: ${file.path} already exists; write a normal patch for it instead of a create patch.`;
      }

      const applied = applyFilePatch(before, file);
      if (!applied.ok || applied.text === undefined) {
        return `Error: ${applied.error ?? "the patch did not apply"}.`;
      }
      prepared.push({
        file,
        target,
        before,
        after: applied.text,
        encoding,
        bom,
        result: {
          path: file.path,
          hunks: applied.applied,
          added: applied.added,
          removed: applied.removed,
          preview: hunkPreview(file, PREVIEW_LINES),
        },
      });
    }

    const summary = prepared
      .map(({ result }) => {
        const preview = result.preview.length > 0 ? `\n${result.preview.map((line) => `  ${line}`).join("\n")}` : "";
        return `${result.path}: ${result.hunks} hunk(s), +${result.added} -${result.removed}${preview}`;
      })
      .join("\n");

    if (previewOnly) {
      return `Preview only - nothing was written.\n${summary}`;
    }

    for (const item of prepared) {
      await fs.mkdir(path.dirname(item.target), { recursive: true });
      const backup = item.before === "" ? null : await ctx.backup(item.target);
      await fs.writeFile(item.target, encodeText(item.after, item.encoding, item.bom));
      ctx.record({
        action: "patch",
        summary: `patched ${item.result.path} (+${item.result.added} -${item.result.removed})`,
        paths: [item.target],
        steps: backup
          ? [{ kind: "restore", path: item.target, backup }]
          : [{ kind: "remove", path: item.target }],
      });
    }

    const files = prepared.length === 1 ? prepared[0].result.path : `${prepared.length} files`;
    return `Patched ${files}.\n${summary}`;
  },
};

/** A model may send the diff under `patch`, `diff` or even `content`. */
function argPatch(args: Record<string, unknown>): string {
  const value = args.patch ?? args.diff ?? args.content ?? args.text;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((line) => String(line)).join("\n");
  return "";
}
