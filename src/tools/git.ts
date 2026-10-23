import path from "node:path";
import { arg, argBool, argNum, argOpt, type Tool } from "./registry.js";
import { jailPath } from "../sandbox.js";
import { clipOutput, runCapture } from "./run.js";

const MAX_OUTPUT = 12_000;
const GIT_TIMEOUT = 60_000;

/**
 * Git, for the parts a coding turn needs: see what changed, stage it, commit it.
 *
 * Deliberately small. `push`, `reset`, `checkout` and `clean` are not actions: a
 * small model that wants to undo work has the audit log (`/undo`) and the file
 * tools, and a force-push is not a mistake the approval prompt should be able to
 * make. Nothing here runs through a shell, so a commit message cannot become a
 * command.
 */
export const gitTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "git",
      description:
        "Work with a git repository: status (what changed), diff (the actual changes), log (recent commits), " +
        "add (stage files) and commit (record staged changes). It never pushes or discards work. " +
        "Commit asks the user first.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["status", "diff", "log", "add", "commit"],
            description: "What to do.",
          },
          path: {
            type: "string",
            description: "Repository folder, relative to the working directory. Default: the working directory.",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: 'For add/commit: files to stage, e.g. ["src/app.ts"]. Default: "." (everything).',
          },
          message: {
            type: "string",
            description: "For commit: the commit message.",
          },
          staged: {
            type: "boolean",
            description: "For diff: show staged changes (git diff --staged).",
          },
          file: {
            type: "string",
            description: "For diff: only this file.",
          },
          max: {
            type: "integer",
            description: "For log: how many commits. Default 10, at most 50.",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = arg(args, "action").trim().toLowerCase();
    const dir = jailPath(argOpt(args, "path")?.trim() || ".");
    const git = (argv: string[]) => runCapture("git", ["-C", dir, ...argv], { cwd: dir, timeoutMs: GIT_TIMEOUT });

    const inside = await git(["rev-parse", "--is-inside-work-tree"]);
    if (inside.code !== 0) {
      const detail = clipOutput((inside.stderr || inside.stdout).trim(), 600);
      return `Error: ${dir} is not inside a git repository.${detail ? `\n${detail}` : ""}`;
    }

    if (action === "status") {
      const result = await git(["status", "--porcelain=v1", "--branch"]);
      if (result.code !== 0) return `Error: git status failed.\n${clipOutput(result.stderr, 2000)}`;
      const lines = result.stdout.replace(/\n$/, "").split("\n").filter(Boolean);
      if (lines.length === 0) return "Working tree clean.";
      const branch = lines.find((line) => line.startsWith("## "));
      const changes = lines.filter((line) => !line.startsWith("## "));
      if (changes.length === 0) return `${branch ?? "On a branch"}\nWorking tree clean.`;
      return `${branch ?? ""}\n${changes.join("\n")}`.trim();
    }

    if (action === "diff") {
      const argv = ["diff", "--no-color", "--no-ext-diff"];
      if (argBool(args, "staged", false)) argv.push("--staged");
      const file = argOpt(args, "file")?.trim();
      if (file) argv.push("--", file);
      const result = await git(argv);
      if (result.code !== 0) return `Error: git diff failed.\n${clipOutput(result.stderr, 2000)}`;
      if (!result.stdout.trim()) {
        return argBool(args, "staged", false) ? "No staged changes." : "No unstaged changes.";
      }
      return clipOutput(result.stdout, MAX_OUTPUT);
    }

    if (action === "log") {
      const max = Math.max(1, Math.min(50, argNum(args, "max", 10)));
      const result = await git(["log", "--no-color", "--oneline", "--decorate", "-n", String(max)]);
      if (result.code !== 0) {
        const text = `${result.stderr}\n${result.stdout}`;
        return /does not have any commits|unknown revision/i.test(text)
          ? "No commits yet."
          : `Error: git log failed.\n${clipOutput(text, 2000)}`;
      }
      return result.stdout.trim() || "No commits yet.";
    }

    const files = stagedFiles(args);
    const addFiles = async (): Promise<string | null> => {
      const result = await git(["add", "--", ...files]);
      if (result.code !== 0) return `Error: git add failed.\n${clipOutput(result.stderr || result.stdout, 2000)}`;
      return null;
    };

    if (action === "add") {
      if (ctx.dryRun) return `DRY RUN: would stage ${files.join(" ")} in ${dir}`;
      const failure = await addFiles();
      if (failure) return failure;
      return `Staged ${files.join(" ")} in ${dir}.\nRun git diff with staged=true to review, then git commit.`;
    }

    if (action === "commit") {
      const message = argOpt(args, "message")?.trim();
      if (!message) return "Error: commit needs a message.";
      if (ctx.dryRun) {
        return `DRY RUN: would stage ${files.join(" ")} and commit in ${dir} with message "${message}"`;
      }
      if (!(await ctx.approve(`commit changes in ${path.basename(dir) || dir}: "${message}"`))) {
        return "Cancelled by user.";
      }
      const failure = await addFiles();
      if (failure) return failure;
      const result = await git(["commit", "-m", message]);
      if (result.code !== 0) {
        const text = `${result.stdout}\n${result.stderr}`.trim();
        return /nothing to commit|no changes added/i.test(text)
          ? "Nothing to commit: the index is empty."
          : `Error: git commit failed.\n${clipOutput(text, 3000)}`;
      }
      const head = await git(["log", "-1", "--format=%h %s"]);
      const stat = await git(["show", "--shortstat", "--format=", "HEAD"]);
      const line = head.stdout.trim();
      const short = stat.stdout.trim();
      return `Committed ${line}${short ? `\n${short.replace(/^\s+/, "")}` : ""}`;
    }

    return `Error: unknown action "${action}". Valid values: status, diff, log, add, commit.`;
  },
};

/** `files` may be an array, a comma-separated string, or missing (= everything). */
function stagedFiles(args: Record<string, unknown>): string[] {
  const raw = args.files;
  let list: string[] = [];
  if (Array.isArray(raw)) list = raw.map((value) => String(value).trim()).filter(Boolean);
  else if (typeof raw === "string") list = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return list.length > 0 ? list : ["."];
}
