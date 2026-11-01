import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Measured model profiles: the storage, the staleness rule, the recommendation
 * rule, and the one safety rule that matters - a dead endpoint must not be saved
 * as a 0% model.
 *
 * This runs without a model. The live probe is exercised by hand against the
 * local endpoint; here we only prove the logic around it.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-profile-test-"));
const data = path.join(root, "data");
process.env.AGENT_DATA_DIR = data;
process.env.AGENT_SETTINGS_FILE = path.join(data, "settings.json");

const source = (name) => pathToFileURL(path.join(process.cwd(), "src", name)).href;
const profiles = await import(source("model-profile.ts"));
const settings = await import(source("settings.ts"));
const { runCalibration } = await import(source("calibrate.ts"));

let passed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` (${detail})` : ""}`);
    process.exitCode = 1;
  }
}
function section(name) {
  console.log(`\n${name}`);
}

const base = "http://127.0.0.1:1234/v1";
const model = "qwen3-coder-30b-a3b-instruct-ud";

function sample(overrides = {}) {
  return {
    key: profiles.modelProfileKey(base, model),
    baseUrl: base,
    model,
    profileId: "local",
    label: `${model} @ ${base}`,
    probeVersion: profiles.MODEL_PROFILE_VERSION,
    testedAt: new Date().toISOString(),
    recommendedMode: "normal",
    score: 86,
    passed: 6,
    total: 7,
    toolReliability: 5 / 6,
    instructionFollowing: 1,
    multiStep: true,
    patch: false,
    recovery: true,
    parallel: true,
    durationMs: 1234,
    requests: 9,
    tokens: 5000,
    tokensPerSecond: 42.5,
    checks: [
      { id: "read", title: "Read", ok: true, ms: 10, detail: "fine" },
      { id: "patch", title: "Patch", ok: false, ms: 20, detail: "used files" },
    ],
    notes: [],
    ...overrides,
  };
}

section("the key");
{
  check("trailing slashes do not make two entries", profiles.modelProfileKey("http://HOST:1234/v1/", "m") === "http://host:1234/v1|m");
  check("the model name is not lowercased", profiles.modelProfileKey(base, "Qwen-30B").endsWith("|Qwen-30B"));
  check("an empty call still produces a stable key", profiles.modelProfileKey("", "") === "|");
}

section("the recommendation rule");
{
  const good = [
    { id: "read", ok: true },
    { id: "write", ok: true },
    { id: "patch", ok: true },
    { id: "multi", ok: true },
  ];
  check(
    "a model that reads, writes, patches and chains gets expert",
    profiles.recommendationFor({ checks: good, toolReliability: 1, instructionFollowing: 1, multiStep: true }) === "expert",
  );
  check(
    "no patch means normal, not expert",
    profiles.recommendationFor({
      checks: good.map((entry) => ({ ...entry, ok: entry.id !== "patch" })),
      toolReliability: 0.9,
      instructionFollowing: 1,
      multiStep: true,
    }) === "normal",
  );
  check(
    "no multi-step means normal",
    profiles.recommendationFor({ checks: good, toolReliability: 1, instructionFollowing: 1, multiStep: false }) === "normal",
  );
  check(
    "a model that cannot read is guided",
    profiles.recommendationFor({
      checks: [{ id: "read", ok: false }, { id: "write", ok: true }],
      toolReliability: 0.5,
      instructionFollowing: 1,
      multiStep: false,
    }) === "guided",
  );
  check(
    "unreliable tools are guided even with a good answer",
    profiles.recommendationFor({ checks: good, toolReliability: 0.4, instructionFollowing: 1, multiStep: true }) === "guided",
  );
  check(
    "ignoring an instruction is guided",
    profiles.recommendationFor({ checks: good, toolReliability: 1, instructionFollowing: 0, multiStep: true }) === "guided",
  );
}

section("saving, finding and deleting");
{
  const saved = profiles.saveModelProfile(sample());
  check("save returns the normalized profile", saved.key === profiles.modelProfileKey(base, model));
  check("it is written to data/model-profiles.json", fs.existsSync(path.join(data, "model-profiles.json")));
  check("it is found again", profiles.findModelProfile(base, model)?.score === 86);
  check("a trailing slash still finds it", profiles.findModelProfile(`${base}/`, model)?.score === 86);
  check("a different model is not found", profiles.findModelProfile(base, "other") === null);
  check("the file has no BOM", fs.readFileSync(path.join(data, "model-profiles.json"))[0] === 0x7b);
  check("the JSON is an object with a version", JSON.parse(fs.readFileSync(path.join(data, "model-profiles.json"), "utf8")).version === 1);

  const updated = profiles.saveModelProfile(sample({ score: 100, passed: 7 }));
  check("saving the same key updates in place", profiles.loadModelProfiles().length === 1);
  check("the new value wins", updated.score === 100);
  check("the recommendation survives a round trip", profiles.measuredMode(base, model) === "normal");

  const removed = profiles.removeModelProfile(profiles.modelProfileKey(base, model));
  check("delete reports that it removed something", removed === true);
  check("the profile is gone", profiles.findModelProfile(base, model) === null);
  check("deleting again reports nothing", profiles.removeModelProfile("nope") === false);
}

section("a stale or broken file is ignored");
{
  const file = path.join(data, "model-profiles.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, profiles: [sample({ probeVersion: 0 })] }), "utf8");
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  check("an old probe version is not used", profiles.findModelProfile(base, model) === null);
  check("the file is still readable", profiles.loadModelProfiles().length === 0);

  fs.writeFileSync(file, "{not json", "utf8");
  fs.utimesSync(file, new Date(), new Date(Date.now() + 9000));
  check("corrupt JSON means not measured", profiles.loadModelProfiles().length === 0);
  check("and it does not throw", true);
}

section("auto prefers a measurement, then the name");
{
  settings.loadSettings();
  const s = {
    agentMode: "auto",
    profiles: [],
    activeProfile: "",
    model: "local-30b",
    baseUrl: base,
  };
  check("no profile and 30B falls back to expert", settings.effectiveAgentMode(s) === "expert");
  check("a 7B falls back to guided", settings.effectiveAgentMode({ ...s, model: "local-7b" }) === "guided");

  profiles.saveModelProfile(sample({ model: "local-30b", recommendedMode: "guided", score: 40, passed: 3 }));
  check("a measured guided wins over the 30B guess", settings.effectiveAgentMode(s) === "guided");
  profiles.removeModelProfile(profiles.modelProfileKey(base, "local-30b"));

  profiles.saveModelProfile(sample({ model: "local-7b", recommendedMode: "expert", score: 100, passed: 7 }));
  check("a measured expert wins over the 7B guess", settings.effectiveAgentMode({ ...s, model: "local-7b" }) === "expert");
  check("an explicit mode still wins over the measurement", settings.effectiveAgentMode({ ...s, model: "local-7b", agentMode: "guided" }) === "guided");
  profiles.removeModelProfile(profiles.modelProfileKey(base, "local-7b"));
}

section("a dead endpoint is not a model verdict");
{
  let error = null;
  try {
    await runCalibration({
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "x",
      model: "nobody",
      profileId: "",
      root: path.join(root, "probe"),
      taskTimeoutMs: 2000,
    });
  } catch (caught) {
    error = caught;
  }
  check("the run fails instead of returning 0%", error !== null, error ? "" : "it returned a profile");
  check("the error explains the endpoint", /endpoint|ECONNREFUSED|fetch failed|connect/i.test(String(error?.message)));
  check("nothing was saved", profiles.findModelProfile("http://127.0.0.1:1/v1", "nobody") === null);
}

process.chdir(os.tmpdir());
fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${process.exitCode ? "with failures" : "0 failed"}`);
