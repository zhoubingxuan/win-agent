// Desktop-control helpers: key parsing and the new `ui` schema, without touching
// the real mouse, keyboard or screen. The dry-run path is the contract the model
// sees; the actual C# calls are exercised by the Windows-only manual check.
// Run with: npm run test:ui
import { parseKeyCombo, uiTool } from "../src/tools/ui.js";

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
function equal(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`);
}

const ctx = {
  dryRun: true,
  guided: false,
  approve: async () => true,
  backup: async () => null,
  record: () => null,
};

section("schema");
{
  const fn = uiTool.schema.function;
  const actions = fn.parameters.properties.action.enum;
  for (const action of [
    "move",
    "click",
    "type",
    "key",
    "scroll",
    "window_list",
    "window_focus",
    "wait",
  ]) {
    check(`the ui tool offers ${action}`, actions.includes(action));
  }
  for (const property of ["x", "y", "button", "clicks", "key", "amount", "handle", "window", "ms"]) {
    check(`the schema documents ${property}`, Object.hasOwn(fn.parameters.properties, property));
  }
  check("the screenshot scale is mentioned", fn.description.includes("scale"));
}

section("key parsing");
{
  equal("ctrl+s", parseKeyCombo("ctrl+s"), [0x11, 0x53]);
  equal("control+shift+esc", parseKeyCombo("control+shift+esc"), [0x11, 0x10, 0x1b]);
  equal("alt+tab", parseKeyCombo("alt+tab"), [0x12, 0x09]);
  equal("win+r", parseKeyCombo("win+r"), [0x5b, 0x52]);
  equal("enter", parseKeyCombo("enter"), [0x0d]);
  equal("f5", parseKeyCombo("f5"), [0x74]);
  equal("f24", parseKeyCombo("f24"), [0x87]);
  equal("a", parseKeyCombo("a"), [0x41]);
  equal("7", parseKeyCombo("7"), [0x37]);
  equal("ctrl+plus", parseKeyCombo("ctrl+plus"), [0x11, 0xbb]);
  equal("ctrl+;", parseKeyCombo("ctrl+;"), [0x11, 0xba]);
  equal("ctrl+shift", parseKeyCombo("ctrl+shift"), [0x11, 0x10]);
  check(
    "an unknown key is rejected",
    (() => {
      try {
        parseKeyCombo("ctrl+not-a-key");
        return false;
      } catch {
        return true;
      }
    })(),
  );
  check(
    "an empty key is rejected",
    (() => {
      try {
        parseKeyCombo(" ");
        return false;
      } catch {
        return true;
      }
    })(),
  );
}

section("dry run");
{
  const move = await uiTool.run({ action: "move", x: 10, y: 20 }, ctx);
  check("move reports the target", move.includes("10,20") && move.includes("DRY RUN"), move);
  const click = await uiTool.run({ action: "click", x: 30, y: 40, button: "right", clicks: 2 }, ctx);
  check("click reports button and count", click.includes("right") && click.includes("2") && click.includes("30,40"), click);
  const type = await uiTool.run({ action: "type", text: "hello" }, ctx);
  check("type reports the length, not the text", type.includes("5 characters") && !type.includes("hello"), type);
  const targetedType = await uiTool.run({ action: "type", text: "hello", window: "Notepad" }, ctx);
  check("type can target a window", targetedType.includes("Notepad"), targetedType);
  const key = await uiTool.run({ action: "key", key: "ctrl+s" }, ctx);
  check("key reports the combination", key.includes("ctrl+s"), key);
  const targetedKey = await uiTool.run({ action: "key", key: "ctrl+s", handle: "123" }, ctx);
  check("key can target a handle", targetedKey.includes("handle 123"), targetedKey);
  const scroll = await uiTool.run({ action: "scroll", amount: -3 }, ctx);
  check("scroll reports direction and amount", scroll.includes("down") && scroll.includes("3"), scroll);
  const focus = await uiTool.run({ action: "window_focus", title: "Notepad" }, ctx);
  check("window_focus reports the title", focus.includes("Notepad"), focus);
  const wait = await uiTool.run({ action: "wait", ms: 250 }, ctx);
  check("wait reports the delay", wait.includes("250"), wait);
}

section("validation");
{
  let oneCoordinate = false;
  try {
    await uiTool.run({ action: "click", x: 1 }, ctx);
  } catch {
    oneCoordinate = true;
  }
  check("click refuses x without y", oneCoordinate);
  let badClicks = false;
  try {
    await uiTool.run({ action: "click", x: 1, y: 2, clicks: 9 }, ctx);
  } catch {
    badClicks = true;
  }
  check("click refuses more than three clicks", badClicks);
  let badWait = false;
  try {
    await uiTool.run({ action: "wait", ms: 60_001 }, ctx);
  } catch {
    badWait = true;
  }
  check("wait refuses more than a minute", badWait);
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
