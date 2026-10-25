import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./store.js";
import type { AgentMode } from "./settings.js";
import { parseJsonWithBom } from "./util/json.js";
import { decodeText } from "./util/text.js";

/**
 * Measured model profiles.
 *
 * `auto` mode used to guess from the number in the model name (14B+ = expert).
 * That guess is cheap and often wrong: a 30B model with broken tool calling is
 * worse than a well-tuned 8B one. A calibration run executes a fixed set of small
 * file tasks against the real endpoint, records what actually happened, and this
 * module turns the result into a recommendation for `auto`.
 *
 * The result lives in `data/model-profiles.json`, one entry per endpoint+model.
 * It contains no secrets and can be deleted from the UI at any time; deleting it
 * returns that model to the old name-based heuristic.
 */

export const MODEL_PROFILE_VERSION = 1;

/** One task's result, kept for the UI so a score can be explained. */
export interface ModelCheck {
  id: string;
  title: string;
  ok: boolean;
  /** Milliseconds this task took, including the model request(s). */
  ms: number;
  /** Why it failed, or a short note when it passed. */
  detail: string;
}

export interface ModelProfile {
  /** Stable identity: normalized baseUrl + model. */
  key: string;
  baseUrl: string;
  model: string;
  /** Endpoint profile id at the time of the test (not part of the key). */
  profileId: string;
  /** Human label for the UI. */
  label: string;
  /** Bumped when the probe tasks change, so old measurements are ignored. */
  probeVersion: number;
  testedAt: string;
  recommendedMode: AgentMode;
  /** 0-100, simply passed / total. */
  score: number;
  passed: number;
  total: number;
  toolReliability: number;
  instructionFollowing: number;
  multiStep: boolean;
  patch: boolean;
  recovery: boolean;
  parallel: boolean;
  durationMs: number;
  requests: number;
  tokens: number;
  tokensPerSecond: number;
  checks: ModelCheck[];
  notes: string[];
}

export interface ModelProfilesFile {
  version: number;
  profiles: ModelProfile[];
}

/** Normalize an endpoint for identity: no trailing slashes, no case noise. */
export function modelProfileKey(baseUrl: string, model: string): string {
  return `${String(baseUrl ?? "").trim().replace(/\/+$/, "").toLowerCase()}|${String(model ?? "").trim()}`;
}

export function modelProfilesFile(): string {
  return path.join(dataDir(), "model-profiles.json");
}

let cache: ModelProfile[] | null = null;
let cacheMtime = -1;

function number(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function mode(value: unknown): AgentMode {
  return value === "expert" || value === "normal" || value === "guided" ? value : "guided";
}

/** Accept only the shape we wrote; a hand-edited file must not crash a turn. */
function normalizeProfile(raw: unknown): ModelProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const baseUrl = String(item.baseUrl ?? "").trim();
  const model = String(item.model ?? "").trim();
  if (!baseUrl || !model) return null;
  const checks = Array.isArray(item.checks)
    ? item.checks
        .map((entry) => {
          const check = (entry ?? {}) as Record<string, unknown>;
          const id = String(check.id ?? "").trim();
          if (!id) return null;
          return {
            id,
            title: String(check.title ?? id),
            ok: bool(check.ok),
            ms: Math.max(0, Math.round(number(check.ms))),
            detail: String(check.detail ?? ""),
          } satisfies ModelCheck;
        })
        .filter((entry): entry is ModelCheck => entry !== null)
    : [];
  return {
    key: modelProfileKey(baseUrl, model),
    baseUrl,
    model,
    profileId: String(item.profileId ?? ""),
    label: String(item.label ?? `${model} @ ${baseUrl}`),
    probeVersion: Math.round(number(item.probeVersion)),
    testedAt: String(item.testedAt ?? ""),
    recommendedMode: mode(item.recommendedMode),
    score: Math.min(100, Math.max(0, Math.round(number(item.score)))),
    passed: Math.max(0, Math.round(number(item.passed))),
    total: Math.max(0, Math.round(number(item.total))),
    toolReliability: Math.min(1, Math.max(0, number(item.toolReliability))),
    instructionFollowing: Math.min(1, Math.max(0, number(item.instructionFollowing))),
    multiStep: bool(item.multiStep),
    patch: bool(item.patch),
    recovery: bool(item.recovery),
    parallel: bool(item.parallel),
    durationMs: Math.max(0, Math.round(number(item.durationMs))),
    requests: Math.max(0, Math.round(number(item.requests))),
    tokens: Math.max(0, Math.round(number(item.tokens))),
    tokensPerSecond: Math.max(0, number(item.tokensPerSecond)),
    checks,
    notes: Array.isArray(item.notes) ? item.notes.map((note) => String(note)).filter(Boolean) : [],
  };
}

/** Read the stored profiles, cached until the file changes. */
export function loadModelProfiles(): ModelProfile[] {
  const file = modelProfilesFile();
  let mtime = -1;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    // No file yet: an empty list, cached so repeated calls stay cheap.
  }
  if (cache !== null && mtime === cacheMtime) return [...cache];
  cacheMtime = mtime;
  cache = [];
  if (mtime < 0) return [];
  try {
    const decoded = decodeText(fs.readFileSync(file));
    const { value } = parseJsonWithBom<ModelProfilesFile | ModelProfile[]>(decoded.text);
    const list = Array.isArray(value) ? value : Array.isArray(value?.profiles) ? value.profiles : [];
    cache = list
      .map(normalizeProfile)
      .filter((entry): entry is ModelProfile => entry !== null && entry.probeVersion === MODEL_PROFILE_VERSION)
      .sort((a, b) => b.testedAt.localeCompare(a.testedAt));
  } catch {
    // A corrupt file means "not measured", never a failed turn.
    cache = [];
  }
  return [...cache];
}

/** Replace or add one profile and write the file atomically. */
export function saveModelProfile(profile: ModelProfile): ModelProfile {
  const normalized = normalizeProfile({ ...profile, probeVersion: MODEL_PROFILE_VERSION });
  if (!normalized) throw new Error("a model profile needs a base URL and a model");
  const list = loadModelProfiles().filter((entry) => entry.key !== normalized.key);
  list.unshift(normalized);
  const file = modelProfilesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body: ModelProfilesFile = { version: MODEL_PROFILE_VERSION, profiles: list };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  cache = null;
  cacheMtime = -1;
  return normalized;
}

/** Delete a result by key. Returns true when something was removed. */
export function removeModelProfile(key: string): boolean {
  const list = loadModelProfiles();
  const next = list.filter((entry) => entry.key !== key);
  if (next.length === list.length) return false;
  const file = modelProfilesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body: ModelProfilesFile = { version: MODEL_PROFILE_VERSION, profiles: next };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  cache = null;
  cacheMtime = -1;
  return true;
}

/** The measurement for this endpoint+model, or null when there is none/stale. */
export function findModelProfile(baseUrl: string, model: string): ModelProfile | null {
  const key = modelProfileKey(baseUrl, model);
  return loadModelProfiles().find((entry) => entry.key === key) ?? null;
}

/** The `auto` shortcut: a fresh measurement wins over the name-based guess. */
export function measuredMode(baseUrl: string, model: string): AgentMode | null {
  const found = findModelProfile(baseUrl, model);
  return found ? found.recommendedMode : null;
}

/** Turn probe checks into a mode. Kept pure so the rule is testable. */
export function recommendationFor(input: {
  checks: Array<{ id: string; ok: boolean }>;
  toolReliability: number;
  instructionFollowing: number;
  multiStep: boolean;
}): AgentMode {
  const passed = new Set(input.checks.filter((check) => check.ok).map((check) => check.id));
  const basicTools = passed.has("read") && passed.has("write");
  // A model that cannot reliably call two tools, or follow a one-line instruction,
  // gets the guided procedure - no measurement should talk us out of that.
  if (!basicTools || input.toolReliability < 0.5 || input.instructionFollowing < 0.5) return "guided";
  // Expert is for models that finish a real multi-step file task and can patch code.
  if (input.toolReliability >= 0.8 && input.multiStep && passed.has("patch")) return "expert";
  return "normal";
}
