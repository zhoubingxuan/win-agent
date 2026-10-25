import { spawn } from "node:child_process";
import { resolveCommand } from "../util/exec.js";

export interface RunResult {
  /** Exit code, or null when a signal killed it. */
  code: number | null;
  timedOut: boolean;
  ms: number;
  stdout: string;
  stderr: string;
  /** The command line as it was actually run (for the model and the audit). */
  commandLine: string;
}

/**
 * Run one process and collect its output. No shell is involved: arguments are
 * passed as an array, so a commit message or a file name cannot turn into an extra
 * command. Output is capped while it is still being produced, because a failing
 * test suite can print megabytes.
 */
export function runCapture(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBytes?: number },
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxBytes = options.maxBytes ?? 1_500_000;
  const executable = resolveCommand(command);
  const started = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let size = 0;
    let timedOut = false;
    let settled = false;

    // Node cannot spawn a .cmd/.bat directly (EINVAL since Node 18.20): npm and
    // pnpm on Windows are batch files, so those go through cmd.exe. The arguments
    // are ours, not the model's, and each one is quoted.
    const batch = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
    const child = batch
      ? spawn([quoteCmdArg(executable), ...args.map(quoteCmdArg)].join(" "), {
          cwd: options.cwd,
          env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...(options.env ?? {}) },
          windowsHide: true,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(executable, args, {
          cwd: options.cwd,
          env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...(options.env ?? {}) },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        timedOut,
        ms: Date.now() - started,
        stdout,
        stderr,
        commandLine: [command, ...args].join(" "),
      });
    };

    const collect = (target: "out" | "err") => (chunk: Buffer) => {
      if (size >= maxBytes) return;
      const text = chunk.toString("utf8");
      size += chunk.length;
      if (target === "out") stdout += text;
      else stderr += text;
    };
    child.stdout?.on("data", collect("out"));
    child.stderr?.on("data", collect("err"));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // Do not wait forever for a process that ignores the signal.
      setTimeout(() => finish(null), 3_000);
    }, timeoutMs);

    child.on("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Quote one argument for `cmd.exe`. Our arguments never contain quotes or pipes. */
function quoteCmdArg(value: string): string {
  return /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function killTree(child: { pid?: number; kill(signal?: NodeJS.Signals): boolean }): void {
  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    // The process may already be gone.
  }
}

/** Keep the head and the tail of a long output: failures are usually at the end. */
export function clipOutput(text: string, max = 12_000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.25);
  const tail = max - head;
  return `${text.slice(0, head)}\n... (${text.length - max} characters trimmed) ...\n${text.slice(-tail)}`;
}
