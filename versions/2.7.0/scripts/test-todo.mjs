// The checklist: the list itself, the tool the model uses to write it, and the words
// the loop uses when it refuses to let a turn end with items still open.
// Run with: npm run test:todo
import { ToolRegistry } from "../src/tools/registry.js";
import { todoTool } from "../src/tools/todo.js";
import { createWindowsTools } from "../src/tools/index.js";
import { DEFAULT_SYSTEM_PROMPT, DEFAULTS, GUIDED_INSTRUCTIONS, toConfig } from "../src/settings.js";
import {
  clearTodos,
  markTodo,
  MAX_TODOS,
  renderTodos,
  seedTodos,
  setTodoTexts,
  subscribeTodos,
  todoNudge,
  todoNudgeNotice,
  todoSummary,
  todos,
  TODO_NUDGE_LIMIT,
  unfinishedTodos,
} from "../src/todo.js";

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

/** A registry that refuses to ask for approval: the checklist never needs one. */
function registry() {
  return new ToolRegistry(async () => {
    throw new Error("the todo tool must never ask for approval");
  }).register(todoTool);
}

const run = (args) => registry().execute("todo", JSON.stringify(args));

try {
  /* ---------------------------------------------------------------------- */
  /* The list                                                               */
  /* ---------------------------------------------------------------------- */

  section("writing the list");
  {
    clearTodos();
    const rendered = setTodoTexts(["read notes.txt", "change the port", "report back"]);
    check("three items get ids 1..3", todos().map((item) => item.id).join(",") === "1,2,3", JSON.stringify(todos()));
    check("the rendered list numbers them", rendered.startsWith("1. [ ] read notes.txt"), rendered);
    check("every step starts open", todos().every((item) => item.status === "todo"));
    check("the tool result is the list itself", rendered.includes("3. [ ] report back"));

    setTodoTexts(["  same   step  ", "same step", "", "  "]);
    check("duplicates collapse", todos().length === 1, JSON.stringify(todos()));
    check("whitespace is squeezed", todos()[0].text === "same step");

    setTodoTexts(["x".repeat(400)]);
    check("one step is capped at 200 characters", todos()[0].text.length === 200, String(todos()[0].text.length));

    setTodoTexts(Array.from({ length: 50 }, (_, index) => `step ${index + 1}`));
    check(`a list stops at ${MAX_TODOS} items`, todos().length === MAX_TODOS, String(todos().length));

    let threw = false;
    try {
      setTodoTexts(["", "  "]);
    } catch {
      threw = true;
    }
    check("an empty plan is refused", threw);
    check("and it keeps the old list", todos().length === MAX_TODOS);

    setTodoTexts(["second plan"]);
    check("a second set replaces the first", todos().length === 1 && todos()[0].text === "second plan");
  }

  section("ticking items off");
  {
    setTodoTexts(["one", "two", "three"]);
    const after = markTodo(2, "doing");
    check("doing is rendered [~]", after.includes("2. [~] two"), after);
    check("status is stored", todos()[1].status === "doing");
    markTodo(2, "done");
    check("done is rendered [x]", renderTodos().includes("2. [x] two"));
    check("unfinished excludes done", unfinishedTodos().map((item) => item.id).join(",") === "1,3");
    markTodo(2, "todo");
    check("reopen puts it back", todos()[1].status === "todo");

    let message = "";
    try {
      markTodo(9, "done");
    } catch (error) {
      message = error.message;
    }
    check("an unknown id is an error", message.includes("no item 9"), message);
    check("the error names the ids that exist", message.includes("1, 2, 3"), message);

    markTodo(1, "done");
    markTodo(2, "done");
    markTodo(3, "done");
    check("all done means nothing is unfinished", unfinishedTodos().length === 0);
    check("the summary counts them", /3\/3 done/.test(todoSummary(todos(), "en")), todoSummary(todos(), "en"));
    check("and says it in Chinese too", /3\/3 项完成/.test(todoSummary(todos(), "zh")), todoSummary(todos(), "zh"));
  }

  section("seeding and clearing");
  {
    seedTodos([
      { id: 9, text: " a ", status: "done" },
      { id: 4, text: "", status: "todo" },
      { id: 7, text: "b", status: "nonsense" },
    ]);
    check("ids are renumbered from 1", todos().map((item) => item.id).join(",") === "1,2", JSON.stringify(todos()));
    check("a blank item is dropped", todos().length === 2);
    check("a bad status becomes open", todos()[1].status === "todo");
    check("the first item keeps its status", todos()[0].status === "done");

    seedTodos(null);
    check("seeding nothing clears the list", todos().length === 0);
    check("the empty list says so", renderTodos() === "(the checklist is empty)");

    setTodoTexts(["a"]);
    clearTodos();
    check("clear empties the list", todos().length === 0);
  }

  section("live updates");
  {
    clearTodos();
    const seen = [];
    const unsubscribe = subscribeTodos((items) => seen.push(items.length));
    setTodoTexts(["a", "b"]);
    markTodo(1, "done");
    check("a listener hears every change", seen.join(",") === "2,2", seen.join(","));
    const copy = todos();
    copy[0].text = "tampered";
    check("the outside world gets a copy", todos()[0].text === "a");
    unsubscribe();
    clearTodos();
    check("unsubscribing stops the noise", seen.length === 2, seen.join(","));
  }

  /* ---------------------------------------------------------------------- */
  /* The tool                                                               */
  /* ---------------------------------------------------------------------- */

  section("the tool surface");
  {
    check("it is called todo", todoTool.schema.function.name === "todo");
    const actions = todoTool.schema.function.parameters.properties.action.enum;
    check(
      "six actions are documented",
      ["set", "list", "done", "doing", "reopen", "clear"].every((action) => actions.includes(action)),
      actions.join(","),
    );
    check("it says that nothing is changed", /Nothing on the machine is changed/.test(todoTool.schema.function.description));

    const tools = createWindowsTools(async () => true, { agentMode: "guided" });
    check("the guided tool set offers todo", tools.names().includes("todo"), tools.names().join(","));
    check("and still withholds the shell", tools.withheld().some((entry) => entry.name === "powershell"));
    const filtered = createWindowsTools(async () => true, { enabledTools: ["files"] });
    check("enabledTools can exclude it", !filtered.names().includes("todo"));
  }

  section("the tool in use");
  {
    clearTodos();
    let result = await run({ action: "set", items: ["first", "second"] });
    check("set returns the numbered plan", result.includes("1. [ ] first") && result.includes("0/2 done"), result);
    result = await run({ action: "list" });
    check("list shows what was set", result.includes("2. [ ] second"), result);

    result = await run({ action: "done", id: 1 });
    check("done marks one item", result.includes("1. [x] first"), result);
    check("and the summary moves", /1\/2 done/.test(result), result);
    result = await run({ action: "doing", id: 2 });
    check("doing marks it as in progress", result.includes("2. [~] second"), result);
    result = await run({ action: "reopen", id: 1 });
    check("reopen clears the tick", result.includes("1. [ ] first"), result);
  }

  section("loose JSON from a small model");
  {
    clearTodos();
    let result = await run({ action: "set", text: "one\ntwo\r\nthree" });
    check("newlines become items (CRLF included)", todos().length === 3, JSON.stringify(todos()));
    check("the result shows them", result.includes("3. [ ] three"));

    result = await run({ action: "set", items: [{ text: "alpha" }, { title: "beta" }] });
    check("objects with text or title are accepted", todos().map((item) => item.text).join(",") === "alpha,beta", JSON.stringify(todos()));

    result = await run({ action: "set", items: ["- dash", "1. numbered", "* star"] });
    check("list markers are stripped", todos().map((item) => item.text).join(",") === "dash,numbered,star", JSON.stringify(todos()));

    result = await run({ action: "complete", id: 1 });
    check("the alias complete works", todos()[0].status === "done", result);
    result = await run({ action: "show" });
    check("the alias show lists", result.includes("Checklist"), result);
    result = await run({ action: "reset" });
    check("the alias reset clears", todos().length === 0, result);
    check("and says the list is empty", /checklist is empty/.test(result), result);

    result = await run({ action: "list" });
    check("listing an empty checklist is not an error", /empty/i.test(result), result);

    result = await run({ action: "done" });
    check("done without an id is refused with a hint", /needs the item "id"/.test(result), result);
    result = await run({ action: "done", id: 99 });
    check("an id that does not exist is refused", /no item 99/.test(result), result);
    result = await run({ action: "dance" });
    check("an unknown action names the real ones", /unknown action "dance"/.test(result) && result.includes("set, list"), result);
    result = await run({ action: "set", items: [] });
    check("setting an empty list is refused, not silently ignored", /at least one|give the steps/.test(result), result);
  }

  /* ---------------------------------------------------------------------- */
  /* The words the loop uses                                                */
  /* ---------------------------------------------------------------------- */

  section("the reminder");
  {
    check("two reminders is the limit", TODO_NUDGE_LIMIT === 2);
    const open = [
      { id: 1, text: "write a.txt", status: "todo" },
      { id: 3, text: "delete b.txt", status: "doing" },
    ];
    const english = todoNudge("en", open);
    check("it names the count", english.startsWith("2 item(s) on your checklist are still open"), english);
    check("it shows the items", english.includes("1. [ ] write a.txt") && english.includes("3. [~] delete b.txt"));
    check("it says what to do", english.includes("mark each one done"));
    const chinese = todoNudge("zh", open);
    check("the Chinese reminder is Chinese", /还有 2 项没有完成/.test(chinese), chinese);
    check("and still shows the items", chinese.includes("write a.txt"));

    check("the user-facing notice is English", /reminder 2/.test(todoNudgeNotice("en", 3, 2)));
    check("the user-facing notice is Chinese", /第 2 次/.test(todoNudgeNotice("zh", 3, 2)));
  }

  section("the prompts mention it");
  {
    check("guided English tells the model to use todo", /call todo with action "set"/.test(GUIDED_INSTRUCTIONS.en));
    check("guided Chinese does too", /先调用 todo/.test(GUIDED_INSTRUCTIONS.zh));
    check("the default prompt does too", /todo tool/.test(DEFAULT_SYSTEM_PROMPT));
    const config = toConfig({ ...DEFAULTS });
    check("the setting is on by default", config.todoCheck === true);
    check("and can be turned off", toConfig({ ...DEFAULTS, todoCheck: false }).todoCheck === false);
  }
} finally {
  clearTodos();
  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}
