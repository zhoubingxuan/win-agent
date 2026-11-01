import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "./agent.js";
import {
  MODEL_PROFILE_VERSION,
  modelProfileKey,
  recommendationFor,
  type ModelCheck,
  type ModelProfile,
} from "./model-profile.js";
import { loadSettings, toConfig, updateSettings, type Config } from "./settings.js";
import { createWindowsTools } from "./tools/index.js";
import { clearTodos } from "./todo.js";
import type { Usage } from "./llm.js";

/**
 * The model capability probe.
 *
 * It is intentionally small: seven tasks, a four-tool surface, and a temporary
 * folder. The point is not to benchmark intelligence but to answer one operational
 * question - can this endpoint reliably read, write, patch and recover on this
 * machine? That is what decides guided / normal / expert for `auto`.
 *
 * Run as a child process (src/server.ts does this), so it cannot chdir, change
 * settings or pollute the conversation of the live agent. It prints one JSON
 * object per line:
 *
 *   {"type":"progress",...}
 *   {"type":"task",...}
 *   {"type":"result","profile":{...}}
 *   {"type":"error","error":"..."}
 */
export const PROBE_VERSION = MODEL_PROFILE_VERSION;
export const PROBE_TASK_IDS = ["read", "write", "patch", "multi", "recover", "answer", "system"] as const;
export type ProbeTaskId = (typeof PROBE_TASK_IDS)[number];

interface RunState {
  finalText: string;
  toolNames: string[];
  toolResults: string[];
  steps: number;
  maxCallsInStep: number;
  usage: Usage;
  requests: number;
}

interface ProbeTask {
  id: ProbeTaskId;
  title: string;
  setup(dir: string): void;
  prompt: string;
  verify(dir: string, run: RunState): { ok: boolean; detail: string };
}

function read(dir: string, name: string): string {
  try {
    return fs.readFileSync(path.join(dir, name), "utf8");
  } catch {
    return "";
  }
}

function write(dir: string, name: string, text: string): void {
  fs.writeFileSync(path.join(dir, name), text, "utf8");
}

const TASKS: ProbeTask[] = [
  {
    id: "read",
    title: "Read a file and use its content",
    setup(dir) {
      write(dir, "probe-read.txt", "alpha\n");
    },
    prompt:
      "Use the files tool with action read to read probe-read.txt. " +
      'Then answer with the single word inside it and nothing else. Do not use another tool.',
    verify(dir, run) {
      const ok =
        run.toolNames.includes("files") &&
        run.finalText.toLowerCase().includes("alpha") &&
        !run.finalText.toLowerCase().includes("error");
      return {
        ok,
        detail: ok
          ? "read the file and repeated its word"
          : `final="${run.finalText.slice(0, 120)}" tools=${run.toolNames.join(",") || "none"}`,
      };
    },
  },
  {
    id: "write",
    title: "Create a file with exact content",
    setup() {
      // nothing to prepare
    },
    prompt:
      "Use the files tool with action write to create probe-write.txt. " +
      "The exact content must be WIN-AGENT-PROBE with no trailing newline or extra text. " +
      "Then answer DONE.",
    verify(dir) {
      const text = read(dir, "probe-write.txt");
      return {
        ok: text === "WIN-AGENT-PROBE",
        detail: text === "WIN-AGENT-PROBE" ? "file is byte-exact" : `file contains ${JSON.stringify(text.slice(0, 120))}`,
      };
    },
  },
  {
    id: "patch",
    title: "Fix code with apply_patch",
    setup(dir) {
      write(dir, "math.js", "export function add(a, b) {\n  return a - b;\n}\n");
    },
    prompt:
      "math.js contains:\n" +
      "export function add(a, b) {\n  return a - b;\n}\n\n" +
      "Use apply_patch with action apply to change `return a - b;` to `return a + b;`. " +
      "Do not rewrite the whole file with files. Then answer PATCHED.",
    verify(dir, run) {
      const text = read(dir, "math.js");
      const patched = /return\s+a\s*\+\s*b\s*;/.test(text);
      const used = run.toolNames.includes("apply_patch");
      return {
        ok: patched && used,
        detail: patched
          ? used
            ? "the hunk applied"
            : "the code is right but files was used instead of apply_patch"
          : `math.js is still ${JSON.stringify(text.slice(0, 120))}`,
      };
    },
  },
  {
    id: "multi",
    title: "Read two files, then write a third",
    setup(dir) {
      write(dir, "probe-a.txt", "alpha\n");
      write(dir, "probe-b.txt", "beta\n");
    },
    prompt:
      "Read probe-a.txt and probe-b.txt with the files tool, then create probe-sum.txt " +
      'whose exact content is "alpha beta" (one space, no trailing newline). Answer MULTI-DONE.',
    verify(dir, run) {
      const text = read(dir, "probe-sum.txt");
      return {
        ok: text === "alpha beta" && run.toolNames.length >= 3,
        detail:
          text === "alpha beta"
            ? `used ${run.toolNames.length} tool calls`
            : `file contains ${JSON.stringify(text.slice(0, 120))} after ${run.toolNames.length} calls`,
      };
    },
  },
  {
    id: "recover",
    title: "React to a missing file and recover",
    setup() {
      // deliberately no probe-missing.txt
    },
    prompt:
      "Read probe-missing.txt with the files tool. If it does not exist, create it with " +
      "the exact content recovered, then read it back and answer RECOVERED.",
    verify(dir, run) {
      const text = read(dir, "probe-missing.txt");
      const sawError = run.toolResults.some((result) => /^Error:|does not exist|not found/i.test(result));
      return {
        ok: text === "recovered" && sawError,
        detail:
          text === "recovered"
            ? sawError
              ? "read failed, then the file was created"
              : "created without reacting to the missing-file error"
            : `file contains ${JSON.stringify(text.slice(0, 120))}`,
      };
    },
  },
  {
    id: "answer",
    title: "Follow a no-tool instruction exactly",
    setup() {
      // pure text task
    },
    prompt: "Reply with exactly PONG and do not call any tool. No quotes, no punctuation, no explanation.",
    verify(_dir, run) {
      const text = run.finalText.trim();
      return {
        ok: text === "PONG" && run.toolNames.length === 0,
        detail: `final=${JSON.stringify(text.slice(0, 80))} tools=${run.toolNames.length}`,
      };
    },
  },
  {
    id: "system",
    title: "Use a read-only system tool",
    setup() {
      // uses the machine, not the folder
    },
    prompt:
      "Use the system tool with action info to inspect this machine, then answer with the " +
      "Windows product name and version in one short sentence.",
    verify(_dir, run) {
      const readsMachine = run.toolNames.includes("system") && run.toolResults.some((result) => /windows/i.test(result));
      const answerUsesIt = /windows/i.test(run.finalText);
      return {
        ok: readsMachine && answerUsesIt,
        detail: readsMachine
          ? answerUsesIt
            ? "read the OS and used the result"
            : `answer did not name Windows: ${JSON.stringify(run.finalText.slice(0, 120))}`
          : "the system tool was not used",
      };
    },
  },
];

/** The probe's own Config: normal mode, no stream, no checklist nagging. */
function probeConfig(): Config {
  const base = toConfig();
  return {
    ...base,
    agentMode: "normal",
    stream: false,
    maxSteps: 8,
    temperature: 0,
    todoCheck: false,
    loopGuard: true,
    contextLimit: Math.min(base.contextLimit || 32_000, 32_000),
    requestTimeoutMs: Math.max(30_000, Math.min(base.requestTimeoutMs, 180_000)),
    maxRetries: 0,
  };
}

function emptyUsage(): Usage {
  return {
    model: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheReported: false,
    elapsedMs: 0,
    tokensPerSecond: null,
    timeToFirstTokenMs: null,
    stopReason: null,
    estimated: false,
  };
}

function addUsage(total: Usage, next: Usage): Usage {
  return {
    model: next.model ?? total.model,
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
    reasoningTokens: total.reasoningTokens + next.reasoningTokens,
    cachedTokens: total.cachedTokens + next.cachedTokens,
    cacheReported: total.cacheReported || next.cacheReported,
    elapsedMs: total.elapsedMs + next.elapsedMs,
    tokensPerSecond: next.tokensPerSecond ?? total.tokensPerSecond,
    timeToFirstTokenMs: next.timeToFirstTokenMs ?? total.timeToFirstTokenMs,
    stopReason: next.stopReason ?? total.stopReason,
    estimated: total.estimated || next.estimated,
  };
}

export interface CalibrationResult {
  profile: ModelProfile;
  tasks: Array<ModelCheck & { id: ProbeTaskId }>;
}

export interface CalibrationOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  profileId: string;
  label?: string;
  root: string;
  /** Milliseconds for one task; 0 = no per-task timer. */
  taskTimeoutMs?: number;
  onProgress?: (event: Record<string, unknown>) => void;
}

/**
 * Run every probe in a fresh subfolder. The caller owns `root`; this function
 * creates it if needed and never deletes it (the caller cleans up).
 */
export async function runCalibration(options: CalibrationOptions): Promise<CalibrationResult> {
  const originalCwd = process.cwd();
  loadSettings();
  updateSettings({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model,
    workdir: options.root,
    sandbox: true,
    autoApprove: true,
    dryRun: false,
    auditLog: false,
    mcpEnabled: false,
    stream: false,
    maxSteps: 8,
    todoCheck: false,
    temperature: 0,
    requestTimeoutMs: 120_000,
  });
  // `jailPath` resolves relative paths against process.cwd(); the sandbox root is
  // the setting. Both have to point at the probe folder.
  fs.mkdirSync(options.root, { recursive: true });
  process.chdir(options.root);
  clearTodos();

  const config = probeConfig();
  const tools = createWindowsTools(async () => true, {
    dryRun: false,
    enabledTools: ["files", "apply_patch", "system", "todo"],
    agentMode: "normal",
  });
  const checks: Array<ModelCheck & { id: ProbeTaskId }> = [];
  const notes: string[] = [];
  let requests = 0;
  let usage = emptyUsage();
  let parallel = false;
  const started = Date.now();

  for (let index = 0; index < TASKS.length; index++) {
    const task = TASKS[index];
    const dir = path.join(options.root, `${String(index + 1).padStart(2, "0")}-${task.id}`);
    fs.mkdirSync(dir, { recursive: true });
    process.chdir(dir);
    updateSettings({ workdir: dir });
    clearTodos();
    task.setup(dir);

    options.onProgress?.({
      type: "progress",
      phase: "task",
      index,
      total: TASKS.length,
      id: task.id,
      title: task.title,
    });

    const state: RunState = {
      finalText: "",
      toolNames: [],
      toolResults: [],
      steps: 0,
      maxCallsInStep: 0,
      usage: emptyUsage(),
      requests: 0,
    };
    let callsThisStep = 0;
    const events = {
      onStep: () => {
        state.steps++;
        callsThisStep = 0;
      },
      onToolCall: (name: string) => {
        state.toolNames.push(name);
        callsThisStep++;
        state.maxCallsInStep = Math.max(state.maxCallsInStep, callsThisStep);
      },
      onToolResult: (_name: string, result: string) => {
        state.toolResults.push(result);
      },
      onUsage: (next: Usage) => {
        state.usage = addUsage(state.usage, next);
        state.requests++;
      },
    };

    const startedTask = Date.now();
    let taskError = "";
    try {
      const agent = new Agent(config, tools, events);
      const signal =
        options.taskTimeoutMs && options.taskTimeoutMs > 0
          ? AbortSignal.timeout(options.taskTimeoutMs)
          : undefined;
      state.finalText = await agent.run(task.prompt, signal);
    } catch (error) {
      taskError = (error as Error).message;
      notes.push(`${task.id}: ${taskError}`);
    }
    let verdict: { ok: boolean; detail: string };
    try {
      verdict = task.verify(dir, state);
    } catch (error) {
      verdict = { ok: false, detail: `check failed: ${(error as Error).message}` };
    }
    const check: ModelCheck & { id: ProbeTaskId } = {
      id: task.id,
      title: task.title,
      ok: verdict.ok && !taskError,
      ms: Date.now() - startedTask,
      detail: taskError ? `${verdict.detail}; error: ${taskError}` : verdict.detail,
    };
    checks.push(check);
    requests += state.requests;
    usage = addUsage(usage, state.usage);
    parallel = parallel || state.maxCallsInStep >= 2;
    options.onProgress?.({ type: "task", index, total: TASKS.length, check });
  }

  // A dead endpoint (or a model that could not load) is not a verdict about the
  // model. Without one successful request the UI says the test failed and keeps
  // the previous profile, instead of writing a misleading 0% result.
  if (requests === 0) {
    process.chdir(originalCwd);
    throw new Error(notes[0] ?? "the endpoint did not answer any probe request");
  }

  const passed = checks.filter((check) => check.ok).length;
  const toolChecks = checks.filter((check) => check.id !== "answer");
  const toolReliability = toolChecks.length === 0 ? 0 : toolChecks.filter((check) => check.ok).length / toolChecks.length;
  const answer = checks.find((check) => check.id === "answer");
  const instructionFollowing = answer?.ok ? 1 : 0;
  const multiStep = checks.find((check) => check.id === "multi")?.ok === true;
  const patch = checks.find((check) => check.id === "patch")?.ok === true;
  const recovery = checks.find((check) => check.id === "recover")?.ok === true;
  const recommendedMode = recommendationFor({
    checks,
    toolReliability,
    instructionFollowing,
    multiStep,
  });
  const durationMs = Date.now() - started;
  const tokens = usage.completionTokens;
  const now = new Date().toISOString();
  const profile: ModelProfile = {
    key: modelProfileKey(options.baseUrl, options.model),
    baseUrl: options.baseUrl,
    model: options.model,
    profileId: options.profileId,
    label: options.label ?? `${options.model} @ ${options.baseUrl}`,
    probeVersion: PROBE_VERSION,
    testedAt: now,
    recommendedMode,
    score: Math.round((passed / Math.max(1, checks.length)) * 100),
    passed,
    total: checks.length,
    toolReliability,
    instructionFollowing,
    multiStep,
    patch,
    recovery,
    parallel,
    durationMs,
    requests,
    tokens: usage.totalTokens,
    tokensPerSecond: durationMs > 0 ? Number((tokens / (durationMs / 1000)).toFixed(2)) : 0,
    checks,
    notes,
  };
  process.chdir(originalCwd);
  return { profile, tasks: checks };
}

/** Print one JSON object per line; the server reads stdout. */
function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * Child-process entry point. Environment is set by src/server.ts:
 * AGENT_MODEL, AGENT_BASE_URL, OPENAI_API_KEY, PROBE_PROFILE_ID, PROBE_LABEL,
 * PROBE_ROOT. No secrets are passed on the command line.
 */
export async function calibrateMain(): Promise<void> {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? process.env.AGENT_BASE_URL ?? "").trim();
  const model = (process.env.AGENT_MODEL ?? "").trim();
  if (!baseUrl || !model) {
    emit({ type: "error", error: "calibration needs an endpoint and a model" });
    process.exitCode = 2;
    return;
  }
  const root = process.env.PROBE_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-probe-"));
  try {
    const result = await runCalibration({
      baseUrl,
      apiKey: process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY ?? "",
      model,
      profileId: process.env.PROBE_PROFILE_ID ?? "",
      label: process.env.PROBE_LABEL,
      root,
      taskTimeoutMs: Number(process.env.PROBE_TASK_TIMEOUT_MS ?? 120_000),
      onProgress: emit,
    });
    emit({ type: "result", profile: result.profile });
  } catch (error) {
    emit({ type: "error", error: (error as Error).message });
    process.exitCode = 1;
  }
}

/** True when this file was started directly (not imported by a test). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
}

if (isEntryPoint()) {
  void calibrateMain();
}
