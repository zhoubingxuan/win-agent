// The agent loop, without Windows and without a real model: a mock endpoint answers
// with the tool calls the test wants, and a fake registry records what was executed.
// Run with: npm run test:agent
//
// What it locks down (1.7):
//   - the same call that already returned the same answer twice is not run a third
//     time, and the model is told why (the loop guard)
//   - a different argument, or a poll whose answer keeps changing, is never blocked
//   - the step limit ends the turn with a message that names the limit and the way
//     on, in the language of the interface
//   - one huge tool result is trimmed before it is stored, with a note saying so
//   - switching the guard off puts the old behaviour back
import http from "node:http";
import { Agent, callSignature, repeatedCall, stepLimit } from "../src/agent.js";
import { DEFAULTS, toConfig } from "../src/settings.js";

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

/* -------------------------------------------------------------------------- */
/* The mock model                                                             */
/* -------------------------------------------------------------------------- */

/** What the mock answers for a marker; `step` counts the requests in one turn. */
const scripts = {
  LOOP: () => call({ x: 1 }),
  POLL: () => call({ x: 1 }),
  VARY: (step) => call({ x: step }),
  BIG: () => call({ x: 1 }),
  // Five calls, then a plain answer: the "no step limit" run.
  FINISH: (step) => (step <= 5 ? call({ x: step }) : null),
};

let requests = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    requests += 1;
    const parsed = JSON.parse(body || "{}");
    const messages = parsed.messages ?? [];
    const user = [...messages].reverse().find((message) => message.role === "user");
    const text = String(user?.content ?? "");
    const marker = Object.keys(scripts).find((name) => text.startsWith(name));
    const step = messages.filter((message) => message.role === "assistant").length + 1;
    const args = marker ? scripts[marker](step) : null;
    const message = args
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${step}`,
              type: "function",
              function: { name: "ping", arguments: JSON.stringify(args) },
            },
          ],
        }
      : { role: "assistant", content: `done after ${step - 1} steps` };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        model: "mock-1",
        choices: [{ index: 0, message, finish_reason: args ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });
});

function call(args) {
  return args;
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

/* -------------------------------------------------------------------------- */
/* The fake registry                                                          */
/* -------------------------------------------------------------------------- */

/** A registry with one tool (`ping`) whose answer the test controls. */
function registry(answer) {
  const calls = [];
  return {
    calls,
    names: () => ["ping"],
    schemas: () => [
      {
        type: "function",
        function: {
          name: "ping",
          description: "A test tool.",
          parameters: { type: "object", properties: { x: { type: "number" } } },
        },
      },
    ],
    describe: () => "- ping: a test tool (argument: x)",
    execute: async (name, raw) => {
      calls.push({ name, args: raw });
      return answer(name, raw, calls.length);
    },
  };
}

/** A fresh agent pointed at the mock endpoint. */
function agentFor(marker, tools, options = {}) {
  const config = toConfig({
    ...DEFAULTS,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "mock-key",
    model: "mock-1",
    stream: false,
    loopGuard: true,
    language: "en",
    maxSteps: 4,
    contextLimit: 0,
    ...options,
  });
  const events = { calls: [], results: [], texts: [] };
  const agent = new Agent(config, tools, {
    onToolCall: (name, args) => events.calls.push({ name, args }),
    onToolResult: (name, result) => events.results.push({ name, result }),
    onAssistantText: (text) => events.texts.push(text),
  });
  return { agent, config, events };
}

try {
  /* ---------------------------------------------------------------------- */
  /* The loop guard                                                         */
  /* ---------------------------------------------------------------------- */

  section("the loop guard");
  {
    const tools = registry(() => "the same answer every time");
    const { agent, events } = agentFor("LOOP", tools, { maxSteps: 4 });
    const final = await agent.run("LOOP ask for the same thing until you give up");

    check("only the first two identical calls ran", tools.calls.length === 2, `ran ${tools.calls.length}`);
    check("every step after that was answered, not executed", events.results.length === 4, `${events.results.length} results`);
    check(
      "the answer says the call was blocked",
      /^Blocked: this exact call \(ping .*\) has already returned the same result twice/.test(events.results[2].result),
      events.results[2].result,
    );
    check("the turn still ends with the step-limit message", /Max steps/.test(final), final);
    check("and the block is in the conversation", agent.getHistory().some((m) => /^Blocked:/.test(String(m.content ?? ""))));
  }

  section("what the guard must not block");
  {
    const tools = registry((_name, _args, n) => `answer ${n}`);
    const { agent } = agentFor("POLL", tools, { maxSteps: 4 });
    await agent.run("POLL poll until something changes");
    // Same call every time, but the answer changes each round: nothing is stuck.
    check("a poll whose answer changes is never blocked", tools.calls.length === 4, `ran ${tools.calls.length}`);

    const varying = registry(() => "fixed");
    const second = agentFor("VARY", varying, { maxSteps: 4 });
    await second.agent.run("VARY use a different argument each time");
    check(
      "a different argument is a different call",
      varying.calls.length === 4 && new Set(varying.calls.map((c) => c.args)).size === 4,
      `ran ${varying.calls.length}`,
    );
  }

  section("switching it off");
  {
    const tools = registry(() => "the same answer every time");
    const { agent } = agentFor("LOOP", tools, { maxSteps: 4, loopGuard: false });
    await agent.run("LOOP again, with the guard off");
    check("the repeated call runs every time", tools.calls.length === 4, `ran ${tools.calls.length}`);
  }

  /* ---------------------------------------------------------------------- */
  /* The step limit                                                         */
  /* ---------------------------------------------------------------------- */

  section("the step limit");
  {
    const tools = registry((_name, _args, n) => `answer ${n}`);
    const { agent } = agentFor("POLL", tools, { maxSteps: 3 });
    const final = await agent.run("POLL keep going");
    check("the limit is named", /"Max steps" limit was reached/.test(final), final);
    check("the way on is given", /Send "continue"/.test(final), final);
    check("the number is the configured one", /after 3 steps/.test(final), final);

    const zh = registry((_name, _args, n) => `answer ${n}`);
    const chinese = agentFor("POLL", zh, { maxSteps: 2, language: "zh" });
    const zhFinal = await chinese.agent.run("POLL 一直做");
    check("the Chinese message is Chinese", /最大步数/.test(zhFinal) && /继续/.test(zhFinal), zhFinal);
  }

  section("no step limit (the new default)");
  {
    const tools = registry((_name, _args, n) => `answer ${n}`);
    const { agent } = agentFor("FINISH", tools, { maxSteps: 0 });
    const final = await agent.run("FINISH take as long as you need");
    check("maxSteps 0 runs past the old limit of 12", tools.calls.length === 5, `ran ${tools.calls.length}`);
    check("the model's own answer ends the turn, not a fuse", /done after 5 steps/.test(final), final);

    // With the step limit gone, repeats are the only brake left.
    const stuck = registry(() => "the same answer every time");
    const second = agentFor("LOOP", stuck, { maxSteps: 0 });
    const stopped = await second.agent.run("LOOP with no step limit");
    check("the repeated call still runs twice", stuck.calls.length === 2, `ran ${stuck.calls.length}`);
    check("five refused repeats end the turn", /blocked repeats/.test(stopped), stopped);
    check("and the turn is bounded, not endless", second.events.results.length === 7, `${second.events.results.length} results`);
  }

  /* ---------------------------------------------------------------------- */
  /* Trimming one big result                                                */
  /* ---------------------------------------------------------------------- */

  section("one huge result");
  {
    const tools = registry(() => "x".repeat(200_000));
    const { agent } = agentFor("BIG", tools, { maxSteps: 2, contextLimit: 0 });
    await agent.run("BIG return something enormous");
    const stored = agent
      .getHistory()
      .filter((m) => m.role === "tool")
      .map((m) => String(m.content ?? ""))
      .find((text) => text.includes("characters trimmed"));
    check("the result was trimmed before it was stored", Boolean(stored), "no trimmed tool message");
    check("the note says how much is missing", Boolean(stored && /characters trimmed; use a narrower call/.test(stored)));
    check("the stored result is bounded", (stored ?? "").length < 30_000, `${(stored ?? "").length} characters`);
    check("both ends are kept", Boolean(stored && stored.startsWith("x") && stored.endsWith("x")));
  }

  /* ---------------------------------------------------------------------- */
  /* Small pure helpers                                                     */
  /* ---------------------------------------------------------------------- */

  section("signatures and messages");
  {
    const one = callSignature({
      id: "a",
      type: "function",
      function: { name: "ping", arguments: '{"a":1,"b":{"c":2,"d":3}}' },
    });
    const same = callSignature({
      id: "b",
      type: "function",
      function: { name: "ping", arguments: '{"b":{"d":3,"c":2},"a":1}' },
    });
    const other = callSignature({ id: "c", type: "function", function: { name: "ping", arguments: '{"a":1}' } });
    check("key order does not change the signature", one === same, `${one} vs ${same}`);
    check("a different argument does", one !== other);

    const english = repeatedCall("en", "ping", '{"x":1}');
    check("the block names the tool", english.includes("ping") && english.includes("Blocked"));
    const long = repeatedCall("en", "ping", "y".repeat(500));
    check("a long argument is shortened in the message", long.length < 400 && long.includes("…"), String(long.length));
    check("the Chinese block is Chinese", /已拦截/.test(repeatedCall("zh", "ping", "{}")));
    check("the Chinese step limit is Chinese", /最大步数/.test(stepLimit("zh", 12)));
  }
} finally {
  server.close();
  console.log(`\n${passed} passed, ${failures} failed  (${requests} model requests)`);
  if (failures > 0) process.exitCode = 1;
}
