// Agent modes, the tool catalogue, JSON repair and Windows text encodings.
// Run with: npm run test:mode
//
// Nothing here needs PowerShell or a model: the agent's system prompt is built in
// its constructor, so the mode can be inspected without ever calling an LLM.
import { Agent, guidanceFor, parseTextToolCall, sanitizeAssistantText, splitToolCalls } from "../src/agent.js";
import { DEFAULTS, GUIDED_INSTRUCTIONS, normalizeAgentMode, toConfig } from "../src/settings.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { parseToolArguments } from "../src/util/json.js";
import { stripClixml } from "../src/util/ps.js";
import { decodeText, detectEncoding, encodeText, encodingLabel } from "../src/util/text.js";

let failures = 0;
let passed = 0;
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
/* The two modes                                                              */
/* -------------------------------------------------------------------------- */

const fakeTool = {
  schema: {
    type: "function",
    function: {
      name: "files",
      description: "Manage files.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "read"] },
          path: { type: "string", description: "Target path." },
          max: { type: "number" },
        },
        required: ["action", "path"],
      },
    },
  },
  run: async () => "ok",
};

function systemPromptOf(mode, language = "en") {
  const registry = new ToolRegistry(async () => true).register(fakeTool);
  const agent = new Agent({ ...toConfig(DEFAULTS), agentMode: mode, language }, registry);
  return agent.getHistory()[0].content;
}

section("agent mode: normal");
{
  const prompt = systemPromptOf("normal");
  check("normal keeps the plain system prompt", prompt.includes(DEFAULTS.systemPrompt));
  check("normal has no operating procedure", !/Operating procedure/.test(prompt));
  check("normal catalogue stays terse", !/arguments: /.test(prompt));
  check("normal still lists the actions", prompt.includes("action must be one of: list, read"));
}

section("agent mode: guided");
{
  const prompt = systemPromptOf("guided");
  check("guided adds the operating procedure", prompt.includes("Operating procedure (follow it exactly)"));
  check("guided forbids parallel tool calls", /ONE tool per step/.test(prompt));
  check("guided forbids invented tools", /do not invent a tool/.test(prompt));
  check("guided tells the model to react to errors", /call the SAME tool again/.test(prompt));
  check("guided catalogue spells out required arguments", /arguments: path \(required\), max/.test(prompt));
  check("guided keeps the user's own prompt", prompt.includes(DEFAULTS.systemPrompt));
  check("the mode is what changes, not the language rule", prompt.includes("Always answer the user in English"));
  check("guided says there is no shell in this mode", /no shell in this mode/.test(prompt));
}

section("agent mode: guided in Chinese");
{
  const prompt = systemPromptOf("guided", "zh");
  check("the procedure is translated", prompt.includes("操作规范（请严格遵守）"));
  check("the no-shell rule is translated", prompt.includes("本模式没有命令行工具"));
  check("the language rule follows the setting", prompt.includes("始终使用简体中文回答用户"));
}

section("withheld tools");
{
  const registry = new ToolRegistry(async () => true).register(fakeTool);
  check("everything registered is offered by default", registry.names().includes("files"));
  check("nothing is withheld by default", registry.withheld().length === 0);

  registry.withhold(["files"], "off for now", "use something else");
  check("a withheld tool is not offered", !registry.names().includes("files"));
  check("it is not in the catalogue", !/^- files:/m.test(registry.describe()), registry.describe());
  check("it is not sent as a schema", registry.schemas().length === 0);

  const hidden = registry.withheld();
  check("the withheld list names it", hidden.length === 1 && hidden[0].name === "files" && hidden[0].reason === "off for now");

  const refused = await registry.execute("files", "{}");
  check("calling it answers with the reason", refused.startsWith("Error:") && refused.includes("off for now"), refused);
  check("and with what to do instead", refused.includes("use something else"), refused);

  const typo = await registry.execute("file", "{}");
  check("a typo never suggests a withheld tool", !/Did you mean "files"/.test(typo), typo);
}

section("agent mode: guidanceFor");
{
  check("guidanceFor(normal) is empty", guidanceFor("normal", "en") === "");
  check("guidanceFor(guided) is the procedure", guidanceFor("guided", "en") === GUIDED_INSTRUCTIONS.en);
  check("guidanceFor(guided, zh) is translated", guidanceFor("guided", "zh") === GUIDED_INSTRUCTIONS.zh);
}

section("agent mode: setting coercion");
{
  check("guided is accepted", normalizeAgentMode("guided") === "guided");
  check("supervised maps to guided", normalizeAgentMode("supervised") === "guided");
  check("高监督 maps to guided", normalizeAgentMode("高监督") === "guided");
  check("normal is accepted", normalizeAgentMode("normal") === "normal");
  check("普通 maps to normal", normalizeAgentMode("普通") === "normal");
  check("unknown values fall back to guided (the safer mode)", normalizeAgentMode("wat") === "guided");
  check("the default mode exists in DEFAULTS", ["normal", "guided"].includes(DEFAULTS.agentMode));
}

section("one tool per step");
{
  const calls = [
    { id: "a", type: "function", function: { name: "files", arguments: "{}" } },
    { id: "b", type: "function", function: { name: "system", arguments: "{}" } },
  ];
  const normal = splitToolCalls(calls, "normal");
  check("normal runs every call", normal.go.length === 2 && normal.extra.length === 0);
  const guided = splitToolCalls(calls, "guided");
  check("guided runs the first call", guided.go.length === 1 && guided.go[0].id === "a");
  check("guided skips the others", guided.extra.length === 1 && guided.extra[0].id === "b");
  const single = splitToolCalls([calls[0]], "guided");
  check("a single call is untouched", single.go.length === 1 && single.extra.length === 0);
}

/* -------------------------------------------------------------------------- */
/* Tool catalogue, unknown tools, JSON repair                                 */
/* -------------------------------------------------------------------------- */

section("catalogue");
{
  const registry = new ToolRegistry(async () => true).register(fakeTool).register({
    schema: {
      type: "function",
      function: {
        name: "system",
        description: "System info.",
        parameters: { type: "object", properties: { action: { type: "string", enum: ["info"] } }, required: ["action"] },
      },
    },
    run: async () => "ok",
  });
  const terse = registry.describe();
  check("terse catalogue names every tool", terse.includes("- files:") && terse.includes("- system:"));
  check("terse catalogue omits the argument list", !terse.includes("arguments:"));
  const verbose = registry.describe({ verbose: true });
  check("verbose catalogue adds the argument list", verbose.includes("arguments: path (required), max"));
  check("a tool with only 'action' gets no argument line", !/system: System info\.\n\s+action must be one of: info\n\s+arguments:/.test(verbose));
  check("the text tool-call fallback is documented", verbose.includes('{"tool": "<tool name>"'));
}

section("unknown tool names");
{
  const registry = new ToolRegistry(async () => true).register(fakeTool);
  const typo = await registry.execute("file", "{}");
  check("a typo suggests the real tool", typo.includes('Did you mean "files"?'), typo);
  const noise = await registry.execute("zzzzzz", "{}");
  check("nonsense still lists what exists", noise.includes("Available tools: files"), noise);
  check("nonsense does not guess", !noise.includes("Did you mean"));
}

section("tool arguments from a small model");
{
  const cases = [
    ['{"action": "list"}', true, "valid JSON"],
    ['{"action": "list",}', true, "trailing comma"],
    ['{action: "list"}', true, "unquoted key"],
    ["{'action': 'list'}", true, "single quotes"],
    ['{"path": "C:\\Users\\Name"}', true, "raw Windows backslashes"],
    ['```json\n{"action": "read"}\n```', true, "fenced block"],
    ['{"path": "C:\\temp\\x"}', true, "a path with one invalid escape"],
    ["not json at all", false, "hopeless input"],
  ];
  for (const [text, expected, label] of cases) {
    const parsed = parseToolArguments(text);
    check(`parses ${label}`, (parsed !== null) === expected, JSON.stringify(parsed));
  }
  const mixed = parseToolArguments('{"path": "C:\\temp\\x"}');
  check(
    "only the invalid escape is doubled",
    mixed.value.path === "C:\temp\\x",
    JSON.stringify(mixed.value.path),
  );
  const repaired = parseToolArguments('{"path": "C:\\Users\\Name"}');
  check("a raw Windows path survives intact", repaired.value.path === "C:\\Users\\Name", JSON.stringify(repaired.value));
  check("the repair is reported", repaired.repair !== null, JSON.stringify(repaired));
  const escape = parseToolArguments('{"text": "a\\tb"}');
  check("\\t is not turned into a literal backslash-t", escape.value.text === "a\tb", JSON.stringify(escape.value));
  const apostrophe = parseToolArguments('{"text": "it\'s fine"}');
  check("an apostrophe inside a quoted string is untouched", apostrophe.value.text === "it's fine");
  const empty = parseToolArguments("   ");
  check("empty arguments become an empty object", empty && Object.keys(empty.value).length === 0);
}

/* -------------------------------------------------------------------------- */
/* Windows text encodings                                                     */
/* -------------------------------------------------------------------------- */

section("text encodings");
{
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello 世界", "utf16le")]);
  const decoded = decodeText(utf16le);
  check("UTF-16 LE is decoded", decoded.text === "hello 世界", JSON.stringify(decoded.text));
  check("the BOM is reported", decoded.bom === "utf16le" && decoded.encoding === "utf16le");
  check("UTF-16 is not mistaken for binary", decoded.binary === false);

  const utf8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi", "utf8")]);
  check("UTF-8 BOM is detected", detectEncoding(utf8bom).bom === "utf8");
  check("UTF-8 BOM is stripped", decodeText(utf8bom).text === "hi");

  const beBytes = Buffer.from("hi", "utf16le");
  beBytes.swap16();
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), beBytes]);
  check("UTF-16 BE is detected", detectEncoding(utf16be).encoding === "utf16be");
  check("UTF-16 BE is decoded", decodeText(utf16be).text === "hi", JSON.stringify(decodeText(utf16be).text));

  const bomless = Buffer.from("plain ascii", "utf16le");
  check("a BOM-less UTF-16 file is still recognised", detectEncoding(bomless).encoding === "utf16le");
  check("plain UTF-8 has no BOM", detectEncoding(Buffer.from("plain", "utf8")).bom === null);

  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00]);
  check("a PNG is flagged as binary", decodeText(binary).binary === true);

  const round = decodeText(encodeText("back to bytes", "utf16le", true));
  check("encode -> decode round-trips", round.text === "back to bytes" && round.bom === "utf16le");
  const roundBe = decodeText(encodeText("endian", "utf16be", true));
  check("UTF-16 BE round-trips", roundBe.text === "endian" && roundBe.encoding === "utf16be");
  check("the label names the encoding", encodingLabel("utf16le", "utf16le").includes("UTF-16 LE"));
}

/* -------------------------------------------------------------------------- */
/* Text tool-call fallback and reply cleanup (unchanged, but still worth it)  */
/* -------------------------------------------------------------------------- */

section("text tool calls and cleanup");
{
  const call = parseTextToolCall('Sure!\n```json\n{"tool": "files", "arguments": {"action": "list"}}\n```');
  check("a fenced JSON block becomes a tool call", call?.call.function.name === "files");
  check("the surrounding text is kept", call?.rest === "Sure!");
  check("a bare JSON object works too", parseTextToolCall('{"tool": "system"}')?.call.function.name === "system");
  check("plain text is not a tool call", parseTextToolCall("The disk is 30% full.") === null);
  check("stray closing tags are removed", sanitizeAssistantText("hi</antwork>") === "hi");
  check("raw template tokens are removed", sanitizeAssistantText("hi<|end_of_turn|>") === "hi");
  check("meaningful tags are kept", sanitizeAssistantText("<b>bold</b>") === "<b>bold</b>");
}

/* -------------------------------------------------------------------------- */
/* PowerShell errors arrive as CLIXML when stderr is redirected                */
/* -------------------------------------------------------------------------- */

section("CLIXML error text");
{
  const clixml =
    '#< CLIXML\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
    '<S S="Error">Get-Service : Cannot find any service with service name \'x\'.</S>' +
    '<S S="Error">所在位置 行:1 字符: 293</S>' +
    "<S S=\"Error\">+ Get-Service -Name x</S>" +
    '<S S="Error">+                 ~</S>' +
    '<S S="Error">    + CategoryInfo          : ObjectNotFound: (x:String) [Get-Service], ServiceCommandException</S>' +
    '<S S="Error">    + FullyQualifiedErrorId : NoServiceFoundForGivenName</S>' +
    "</Objs>";
  const plain = stripClixml(clixml);
  check("the message survives", /Cannot find any service with service name 'x'/.test(plain), plain);
  check("the localized location line is gone", !/所在位置/.test(plain), plain);
  check("the console noise is gone", !plain.includes("+ CategoryInfo") && !plain.includes("+ Get-Service"), plain);
  check("plain text is passed through", stripClixml("just a message") === "just a message");
  check(
    "XML escaping is undone",
    stripClixml('<Objs Version="1.1.0.1"><S S="Error">&lt;hello&gt; &amp; bye</S></Objs>') === "<hello> & bye",
  );
}

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exitCode = 1;
