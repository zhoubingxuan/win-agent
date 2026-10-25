// Quick, model-free checks for the context planner.
// Run with: npm test   (tsx compiles the TypeScript on the fly, no build needed)
import { planContext, measure, estimateTokens, toolCapFor } from "../src/context.js";

let failures = 0;
function check(label, condition, extra = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

const system = { role: "system", content: `system prompt ${"x".repeat(800)}` };

/** One complete exchange: question, tool call, big tool result, answer. */
function calls(n, size = 20_000) {
  return [
    { role: "user", content: `question ${n}` },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: `c${n}`, type: "function", function: { name: "files", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: `c${n}`, name: "files", content: `${"y".repeat(size)} result ${n}` },
    { role: "assistant", content: `answer ${n}` },
  ];
}

console.log("estimateTokens");
check("CJK counts about one token per character", estimateTokens("\u4f60\u597d\u4e16\u754c") === 4);
check("latin is roughly 4 chars per token", estimateTokens("abcdefgh") === 2);

console.log("toolCapFor");
check("unknown window -> 24000 chars", toolCapFor(0) === 24_000);
check("8000 token window -> 2000 chars (floor)", toolCapFor(8_000) === 2_000);
check("128k window -> 12000 chars (ceiling)", toolCapFor(131_072) === 12_000);

console.log("no limit: nothing is dropped, oversized tool results are still capped");
{
  const plan = planContext([system, ...calls(1), ...calls(2)], { limit: null });
  check("keeps every message", plan.messages.length === 9, `got ${plan.messages.length}`);
  check("squeezes both oversized tool results", plan.stats.truncatedToolResults === 2);
  check("drops nothing", plan.stats.droppedMessages === 0);
  check("no limit is reported", plan.stats.limit === null);
}

console.log("roomy limit: squeezing is preferred over dropping");
{
  const messages = [system, ...calls(1), ...calls(2), ...calls(3), ...calls(4), ...calls(5), ...calls(6)];
  const limit = 12_000;
  const plan = planContext(messages, { limit, toolCap: toolCapFor(limit) });
  check("all six tool results squeezed", plan.stats.truncatedToolResults === 6, JSON.stringify(plan.stats));
  check("nothing dropped", plan.stats.droppedMessages === 0);
  check(
    "fits the budget",
    measure(plan.messages) <= plan.stats.budget,
    `${measure(plan.messages)} > ${plan.stats.budget}`,
  );
}

console.log("tight limit: oldest exchanges go first, newest survives");
{
  const messages = [
    system,
    ...calls(1),
    ...calls(2),
    ...calls(3),
    ...calls(4),
    ...calls(5),
    ...calls(6),
    { role: "user", content: "latest question" },
  ];
  const limit = 3_000;
  const plan = planContext(messages, { limit, toolCap: toolCapFor(limit) });
  check("system prompt is kept, untouched", plan.messages[0].content === system.content);
  check("something was dropped", plan.stats.droppedMessages > 0, JSON.stringify(plan.stats));
  check("older questions went away", !plan.messages.some((m) => m.content === "question 1"));
  check("the newest question survived", plan.messages.some((m) => m.content === "latest question"));
  check(
    "no assistant-with-tool_calls is left without its tool result",
    plan.messages.every((m, i) => {
      if (!m.tool_calls || m.tool_calls.length === 0) return true;
      return plan.messages
        .slice(i + 1)
        .some((t) => t.role === "tool" && t.tool_call_id === m.tool_calls[0].id);
    }),
  );
  check(
    "the plan fits the budget",
    measure(plan.messages) <= plan.stats.budget,
    `${measure(plan.messages)} > ${plan.stats.budget}`,
  );
}

console.log("impossible limit: system prompt is never squeezed, nothing crashes");
{
  const plan = planContext([system, ...calls(1), { role: "user", content: "hi" }], { limit: 400 });
  check("system prompt intact", plan.messages[0].content === system.content);
  check("still returns messages", plan.messages.length >= 2, `got ${plan.messages.length}`);
}

console.log(failures === 0 ? "\nall context checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
