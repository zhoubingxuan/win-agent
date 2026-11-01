import fs from "node:fs/promises";
import path from "node:path";
import { argNum, argOpt, type Tool } from "./registry.js";
import { jailPath } from "../sandbox.js";
import { clipOutput, runCapture } from "./run.js";

const MAX_OUTPUT = 12_000;
const DEFAULT_TIMEOUT_S = 300;

interface Detection {
  label: string;
  command: string;
  args: string[];
  why: string;
}

/**
 * Run the project's own tests, without letting the model write the command.
 *
 * A coder turn is not done when the file looks right; it is done when the tests
 * pass. Letting a small model invent "npm test || true" defeats that, so the command
 * is detected from the project (package.json, pytest, cargo, go, dotnet) and the
 * model only chooses "detect" or "run". Running tests executes project code, so the
 * user is asked first.
 */
export const testsTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "tests",
      description:
        "Find and run this project's own tests. It detects npm/pnpm/yarn, pytest, cargo, go and dotnet test " +
        "from the files in the folder, runs the real command and returns the failure output. " +
        "Use it after changing code, instead of guessing whether the change works.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["detect", "run"],
            description: "detect = only say which command would run; run = execute it.",
          },
          path: {
            type: "string",
            description: "Project folder, relative to the working directory. Default: the working directory.",
          },
          timeoutSec: {
            type: "integer",
            description: `How long to allow, in seconds. Default ${DEFAULT_TIMEOUT_S}, at most 900.`,
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = (argOpt(args, "action") ?? "run").trim().toLowerCase();
    if (action !== "detect" && action !== "run") {
      return `Error: unknown action "${action}". Use "detect" or "run".`;
    }
    const dir = jailPath(argOpt(args, "path")?.trim() || ".");
    const found = await detect(dir);
    if (!found) {
      return (
        `No test command found in ${dir}.\n` +
        "Looked for: package.json scripts.test, pytest (pyproject.toml / pytest.ini / tests/*.py), " +
        "Cargo.toml, go.mod, and a .sln file."
      );
    }
    const commandLine = [found.command, ...found.args].join(" ");

    if (action === "detect") {
      return `Detected ${found.label} in ${dir}\n  command: ${commandLine}\n  because: ${found.why}`;
    }

    if (ctx.dryRun) return `DRY RUN: would run "${commandLine}" in ${dir} (${found.why}).`;
    if (!(await ctx.approve(`run the project's tests (${found.label}) in ${path.basename(dir) || dir}`))) {
      return "Cancelled by user.";
    }

    const timeoutSec = Math.max(10, Math.min(900, argNum(args, "timeoutSec", DEFAULT_TIMEOUT_S)));
    const result = await runCapture(found.command, found.args, {
      cwd: dir,
      timeoutMs: timeoutSec * 1000,
      maxBytes: 2_000_000,
    });
    const seconds = (result.ms / 1000).toFixed(1);
    const header = result.timedOut
      ? `${found.label} in ${dir}: TIMED OUT after ${seconds}s (${commandLine})`
      : `${found.label} in ${dir}: exit ${result.code ?? "?"} in ${seconds}s (${commandLine})`;

    const output = `${result.stdout}${result.stderr ? `${result.stdout ? "\n" : ""}${result.stderr}` : ""}`.trim();
    if (!output) {
      return `${header}\n(no output)`;
    }
    return `${header}\n${clipOutput(output, MAX_OUTPUT)}`;
  },
};

/**
 * The first project type that has a real test command. Order is deliberate: a repo
 * with both a package.json and a Python tool folder is usually a JS project whose
 * tests are the JS ones, and `npm test` is the cheapest to explain.
 */
async function detect(dir: string): Promise<Detection | null> {
  const packageJson = await readJson(path.join(dir, "package.json"));
  if (packageJson) {
    const scripts = packageJson.scripts as Record<string, unknown> | undefined;
    const script = typeof scripts?.test === "string" ? scripts.test.trim() : "";
    const placeholder = /^echo\s+["']?Error: no test specified/i.test(script);
    if (script && !placeholder) {
      const manager = await packageManager(dir);
      return {
        label: `${manager} test`,
        command: manager,
        args: manager === "npm" ? ["test", "--silent"] : ["test"],
        why: 'package.json has a "test" script',
      };
    }
  }

  if (await hasPytest(dir)) {
    return {
      label: "pytest",
      command: "python",
      args: ["-m", "pytest", "-q"],
      why: "pytest configuration or a tests folder with .py files",
    };
  }

  if (await exists(path.join(dir, "Cargo.toml"))) {
    return { label: "cargo test", command: "cargo", args: ["test", "--quiet"], why: "Cargo.toml" };
  }

  if (await exists(path.join(dir, "go.mod"))) {
    return { label: "go test", command: "go", args: ["test", "./..."], why: "go.mod" };
  }

  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  if (entries.some((entry) => entry.toLowerCase().endsWith(".sln"))) {
    return { label: "dotnet test", command: "dotnet", args: ["test", "--nologo"], why: "a .sln file" };
  }

  return null;
}

async function packageManager(dir: string): Promise<string> {
  if (await exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(dir, "yarn.lock"))) return "yarn";
  if (await exists(path.join(dir, "bun.lockb"))) return "bun";
  return "npm";
}

async function hasPytest(dir: string): Promise<boolean> {
  for (const name of ["pytest.ini", "tox.ini"]) {
    if (await exists(path.join(dir, name))) return true;
  }
  const pyproject = await fs.readFile(path.join(dir, "pyproject.toml"), "utf8").catch(() => "");
  if (/\[tool\.pytest/.test(pyproject)) return true;
  const tests = path.join(dir, "tests");
  const entries = await fs.readdir(tests).catch(() => [] as string[]);
  return entries.some((entry) => entry.toLowerCase().endsWith(".py"));
}

async function readJson(target: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await fs.readFile(target, "utf8");
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
