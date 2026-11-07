// Vision input: validation, the OpenAI wire shape, tool-result images, and the
// context budget. No real model and no screen capture are needed.
// Run with: npm run test:vision
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chat } from "../src/llm.js";
import { Agent } from "../src/agent.js";
import { planContext } from "../src/context.js";
import {
  estimateImageTokens,
  imageDataUrl,
  normalizeImages,
  readImageFile,
  MAX_IMAGES_PER_MESSAGE,
} from "../src/images.js";
import {
  DEFAULTS,
  looksLikeVisionModel,
  normalizeVisionMode,
  toConfig,
  visionEnabled,
} from "../src/settings.js";

let passed = 0;
let failures = 0;
function check(label, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}
function section(name) {
  console.log(`\n${name}`);
}

/** A real 1x1 PNG. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function freePorts(n) {
  const ports = new Set();
  while (ports.size < n) {
    ports.add(
      await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          const { port } = probe.address();
          probe.close(() => resolve(port));
        });
      }),
    );
  }
  return [...ports];
}

const requests = [];
let handler = null;

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: req.url, body });
    if (handler && handler(body, res, requests.length)) return;
    reply(res, "ok");
  });
});

function reply(res, text, message = { role: "assistant", content: text }) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      model: "mock-1",
      choices: [{ index: 0, message, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }),
  );
}

function toolReply(res, name, args) {
  reply(res, null, {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
}

const [mockPort] = await freePorts(1);
await new Promise((resolve) => server.listen(mockPort, "127.0.0.1", resolve));

const config = (over = {}) => ({
  apiKey: "test",
  baseUrl: `http://127.0.0.1:${mockPort}/v1`,
  model: "gpt-4o",
  maxSteps: 0,
  temperature: 0,
  loopGuard: true,
  todoCheck: false,
  language: "en",
  systemPrompt: "test",
  workdir: process.cwd(),
  agentMode: "expert",
  vision: true,
  stream: false,
  contextLimit: 0,
  requestTimeoutMs: 10_000,
  maxRetries: 0,
  ...over,
});

section("image validation");
{
  const one = normalizeImages([{ mimeType: "image/png", data: PNG }]);
  check("a PNG is accepted", one.length === 1 && one[0].mimeType === "image/png");
  check("dimensions are read from the header", one[0].width === 1 && one[0].height === 1);
  check("the data is canonical base64", one[0].data === PNG);
  check("a data URL is accepted", normalizeImages([{ data: `data:image/png;base64,${PNG}` }]).length === 1);
  check("imageDataUrl has the data: prefix", imageDataUrl(one[0]).startsWith("data:image/png;base64,"));

  let rejected = false;
  try {
    normalizeImages([{ mimeType: "image/jpeg", data: PNG }]);
  } catch {
    rejected = true;
  }
  check("a MIME type that disagrees with the bytes is rejected", rejected);

  rejected = false;
  try {
    normalizeImages([{ mimeType: "image/png", data: "not base64!" }]);
  } catch {
    rejected = true;
  }
  check("invalid base64 is rejected", rejected);

  rejected = false;
  try {
    normalizeImages(Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, () => ({ mimeType: "image/png", data: PNG })));
  } catch {
    rejected = true;
  }
  check("too many images are rejected", rejected);

  rejected = false;
  try {
    normalizeImages([{ mimeType: "image/png", data: Buffer.from("plain text").toString("base64") }]);
  } catch {
    rejected = true;
  }
  check("non-image bytes are rejected", rejected);

  check("normalizeImages(undefined) is empty", normalizeImages(undefined).length === 0);
}

section("reading an image file");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-vision-"));
  const file = path.join(dir, "pixel.png");
  fs.writeFileSync(file, Buffer.from(PNG, "base64"));
  const image = readImageFile(file);
  check("readImageFile reads a PNG", image.mimeType === "image/png" && image.data === PNG);
  check("readImageFile keeps the file name", image.name === "pixel.png");
  check("readImageFile knows the size", image.width === 1 && image.height === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

section("token estimate");
{
  check("a missing size is a high-detail guess", estimateImageTokens({ mimeType: "image/png", data: "" }) === 1024);
  check("a tiny image has the minimum", estimateImageTokens({ mimeType: "image/png", data: "", width: 10, height: 10 }) === 85);
  check(
    "a large image is capped",
    estimateImageTokens({ mimeType: "image/png", data: "", width: 2000, height: 2000 }) === 1600,
  );
}

section("vision model detection");
{
  check("qwen2.5-vl is a vision model", looksLikeVisionModel("qwen/qwen2.5-vl-32b-instruct"));
  check("qwen3.8-27b is not", !looksLikeVisionModel("qwen/qwen3.8-27b"));
  check("gpt-4o is a vision model", looksLikeVisionModel("gpt-4o-mini"));
  check("gpt-4.1 is a vision model", looksLikeVisionModel("gpt-4.1"));
  check("llama vision is a vision model", looksLikeVisionModel("llama-3.2-11b-vision-instruct"));
  check("a coder model is not", !looksLikeVisionModel("qwen3-coder-30b-a3b-instruct"));
  check("auto follows the model name", visionEnabled({ model: "qwen2.5-vl", visionMode: "auto" }));
  check("off overrides the name", !visionEnabled({ model: "qwen2.5-vl", visionMode: "off" }));
  check("on overrides the name", visionEnabled({ model: "my-local-vision", visionMode: "on" }));
  check("unknown modes fall back to auto", normalizeVisionMode("what") === "auto");
  check("on is case-insensitive", normalizeVisionMode("ON") === "on");
}

section("OpenAI content parts");
{
  const image = normalizeImages([{ mimeType: "image/png", data: PNG, width: 1, height: 1 }])[0];
  requests.length = 0;
  handler = null;
  await chat(config(), [{ role: "user", content: "look at this", images: [image] }], []);
  const body = requests.at(-1).body;
  const content = body.messages[0].content;
  check("a user message becomes a content array", Array.isArray(content));
  check("the text part is first", content?.[0]?.type === "text" && content[0].text === "look at this");
  check("the image part uses image_url", content?.[1]?.type === "image_url");
  check(
    "the image is a base64 data URL",
    String(content?.[1]?.image_url?.url ?? "").startsWith("data:image/png;base64,"),
  );

  requests.length = 0;
  await chat(
    config(),
    [{ role: "tool", tool_call_id: "call_1", name: "ui", content: "screenshot", images: [image] }],
    [],
  );
  const messages = requests.at(-1).body.messages;
  check("a tool result stays a text tool message", messages[0].role === "tool" && messages[0].content === "screenshot");
  check("an image follows the tool result as a user message", messages[1].role === "user");
  check(
    "the follow-up says where the image came from",
    Array.isArray(messages[1].content) && messages[1].content[0].text.includes("ui"),
  );
  check(
    "the follow-up carries the image",
    Array.isArray(messages[1].content) && messages[1].content.some((part) => part.type === "image_url"),
  );
}

section("the agent keeps a tool image");
{
  const image = normalizeImages([{ mimeType: "image/png", data: PNG, width: 1, height: 1 }])[0];
  let step = 0;
  requests.length = 0;
  handler = (body, res) => {
    step += 1;
    if (step === 1) {
      toolReply(res, "ui", { action: "screenshot" });
      return true;
    }
    reply(res, "I can see the screen.");
    return true;
  };
  const events = [];
  const tools = {
    schemas: () => [],
    names: () => ["ui"],
    describe: () => "ui: take a screenshot",
    executeDetailed: async () => ({ text: "screen captured", images: [image] }),
  };
  const agent = new Agent(
    toConfig({ ...DEFAULTS, baseUrl: config().baseUrl, model: "gpt-4o", visionMode: "on", maxSteps: 0 }),
    tools,
    { onToolResult: (name, result, images) => events.push({ name, result, images }) },
    [],
  );
  const answer = await agent.run("look at the screen");
  check("the turn finishes", answer === "I can see the screen.");
  check("the tool result event carries the image", events[0]?.images?.length === 1);
  const second = requests.at(-1).body.messages;
  const tool = second.find((message) => message.role === "tool");
  const follow = second.find(
    (message) => message.role === "user" && Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"),
  );
  check("the tool message says an image is attached", String(tool?.content ?? "").includes("image(s) attached"));
  check("the follow-up user message carries the image", Boolean(follow));
}

section("the agent refuses an image when vision is off");
{
  const image = normalizeImages([{ mimeType: "image/png", data: PNG, width: 1, height: 1 }])[0];
  let step = 0;
  requests.length = 0;
  handler = (body, res) => {
    step += 1;
    if (step === 1) {
      toolReply(res, "ui", { action: "screenshot" });
      return true;
    }
    reply(res, "saved.");
    return true;
  };
  const events = [];
  const tools = {
    schemas: () => [],
    names: () => ["ui"],
    describe: () => "ui: take a screenshot",
    executeDetailed: async () => ({ text: "screen captured", images: [image] }),
  };
  const agent = new Agent(
    toConfig({ ...DEFAULTS, baseUrl: config().baseUrl, model: "gpt-4o", visionMode: "off", maxSteps: 0 }),
    tools,
    { onToolResult: (name, result, images) => events.push({ name, result, images }) },
    [],
  );
  await agent.run("take a screenshot");
  check("the event has no image", events[0]?.images === undefined);
  const second = requests.at(-1).body.messages;
  check(
    "no image part is sent",
    !second.some(
      (message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"),
    ),
  );
  check(
    "the model is told why",
    String(second.find((message) => message.role === "tool")?.content ?? "").includes("image not attached"),
  );
}

section("the context budget drops images before failing");
{
  const image = normalizeImages([{ mimeType: "image/png", data: PNG, width: 1600, height: 1600 }])[0];
  const plan = planContext(
    [
      { role: "system", content: "system" },
      { role: "user", content: "a".repeat(4000), images: [image] },
    ],
    { limit: 300, toolCap: 100, extraTokens: 0 },
  );
  check("the image is counted as dropped", plan.stats.droppedImages === 1);
  check("the stored message still has its text", plan.messages[1].content.startsWith("aaaa"));
  check("the note explains the omission", plan.messages[1].content.includes("image omitted"));
  check("the image is gone from the copy", plan.messages[1].images === undefined);
  check("the plan is marked trimmed", plan.stats.trimmed);
}

server.close();
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
