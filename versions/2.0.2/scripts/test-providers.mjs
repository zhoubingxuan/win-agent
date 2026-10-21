// Provider compatibility checks against a mock OpenAI endpoint.
// Run with: npm run test:providers
import http from "node:http";
import net from "node:net";
import { chat } from "../src/llm.js";
import { capabilities, rejectedField } from "../src/providers.js";

let failures = 0;
function check(label, condition, extra = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

/**
 * Free ports from the OS. A fixed port made this suite die at startup (EADDRINUSE)
 * whenever anything else on the machine happened to hold it - and a suite that dies
 * before its first check says nothing at all about the code.
 */
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
/** Set per scenario: (body, res) => boolean (handled). */
let handler = () => false;

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: req.url, body });
    if (handler(body, res)) return;
    reply(res, "hello from the mock");
  });
});

function reply(res, text, extra = {}) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      model: "mock-1",
      choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      ...extra,
    }),
  );
}

function reject(res, status, message, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ error: { message, type: "invalid_request_error" } }));
}

// One port for the mock endpoint, one that stays empty for the "cannot reach it"
// check below.
const [mockPort, deadPort] = await freePorts(2);

const config = (over = {}) => ({
  apiKey: "test",
  baseUrl: `http://127.0.0.1:${mockPort}/v1`,
  model: "mock-1",
  maxSteps: 4,
  temperature: 0,
  language: "en",
  systemPrompt: "test",
  workdir: process.cwd(),
  stream: false,
  contextLimit: 0,
  requestTimeoutMs: 10_000,
  maxRetries: 2,
  ...over,
});

const tool = [
  {
    type: "function",
    function: { name: "ping", description: "ping", parameters: { type: "object", properties: {} } },
  },
];

await new Promise((resolve) => server.listen(mockPort, "127.0.0.1", resolve));

console.log("rejectedField()");
check("detects tools", rejectedField("Unsupported parameter: 'tools'") === "tools");
check("detects tool_choice", rejectedField("tool_choice is not supported") === "toolChoice");
check("detects stream_options", rejectedField("unknown field stream_options") === "streamOptions");
check("detects stream", rejectedField("stream is not supported by this endpoint") === "stream");
check("ignores unrelated errors", rejectedField("model not found") === null);

console.log("endpoint rejects `tools` -> retried without them");
{
  requests.length = 0;
  let seen = 0;
  handler = (body, res) => {
    if (body.tools) {
      seen += 1;
      reject(res, 400, "Unsupported parameter: 'tools' is not supported with this model.");
      return true;
    }
    return false;
  };
  const result = await chat(config(), [{ role: "user", content: "hi" }], tool);
  check("two requests were sent", requests.length === 2, `got ${requests.length}`);
  check("the first one carried tools", Array.isArray(requests[0].body.tools));
  check("the second one did not", requests[1].body.tools === undefined);
  check("the answer came back anyway", result.message.content === "hello from the mock");
  check("usage survived the fallback", result.usage.promptTokens === 10 && result.usage.completionTokens === 4);
  check("the endpoint is remembered as having no tools", capabilities(config().baseUrl, "mock-1").tools === false);
  check("the rejection was noticed once", seen === 1);
}

console.log("endpoint rate limits once -> retried and succeeds");
{
  requests.length = 0;
  const key = "rate-limit-model";
  let first = true;
  handler = (body, res) => {
    if (first) {
      first = false;
      reject(res, 429, "Too many requests", { "Retry-After": "0" });
      return true;
    }
    return false;
  };
  const result = await chat(config({ model: key }), [{ role: "user", content: "hi" }], []);
  check("two requests were sent", requests.length === 2, `got ${requests.length}`);
  check("the retry succeeded", result.message.content === "hello from the mock");
}

console.log("server error then success");
{
  requests.length = 0;
  let first = true;
  handler = (body, res) => {
    if (first) {
      first = false;
      reject(res, 503, "model is loading");
      return true;
    }
    return false;
  };
  const result = await chat(config({ model: "flaky" }), [{ role: "user", content: "hi" }], []);
  check("retried the 503", requests.length === 2, `got ${requests.length}`);
  check("the retry succeeded", result.message.content === "hello from the mock");
}

console.log("retries stop when they are exhausted");
{
  requests.length = 0;
  handler = (body, res) => {
    reject(res, 500, "always broken");
    return true;
  };
  let message = "";
  try {
    await chat(config({ model: "broken", maxRetries: 1 }), [{ role: "user", content: "hi" }], []);
  } catch (error) {
    message = error.message;
  }
  check("tried twice (1 original + 1 retry)", requests.length === 2, `got ${requests.length}`);
  check("the failure is reported clearly", /request failed \(500\)/.test(message), message);
}

console.log("a plain 400 is not retried");
{
  requests.length = 0;
  handler = (body, res) => {
    reject(res, 400, "the request body is malformed");
    return true;
  };
  let message = "";
  try {
    await chat(config({ model: "bad-request" }), [{ role: "user", content: "hi" }], []);
  } catch (error) {
    message = error.message;
  }
  check("only one request was sent", requests.length === 1, `got ${requests.length}`);
  check("the message is passed through", message.includes("malformed"), message);
}

console.log("unreachable endpoint is reported, not crashed on");
{
  let message = "";
  try {
    await chat(config({ baseUrl: `http://127.0.0.1:${deadPort}/v1`, maxRetries: 0 }), [{ role: "user", content: "hi" }], []);
  } catch (error) {
    message = error.message;
  }
  check("says it cannot reach the endpoint", /cannot reach/.test(message), message);
}

console.log("timeout is enforced and reported");
{
  requests.length = 0;
  handler = async (body, res) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    reply(res, "too late");
    return true;
  };
  let message = "";
  try {
    await chat(config({ model: "slow", requestTimeoutMs: 150, maxRetries: 0 }), [{ role: "user", content: "hi" }], []);
    message = "no error";
  } catch (error) {
    message = error.message;
  }
  check("abandons a request that takes too long", /did not answer within/.test(message), message);
}

console.log("a slow but in-time answer is kept");
{
  requests.length = 0;
  handler = async (body, res) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    reply(res, "made it");
    return true;
  };
  const result = await chat(
    config({ model: "slow-2", requestTimeoutMs: 5_000, maxRetries: 0 }),
    [{ role: "user", content: "hi" }],
    [],
  );
  check("kept the answer", result.message.content === "made it", result.message.content ?? "null");
}

server.close();
console.log(failures === 0 ? "\nall provider checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
