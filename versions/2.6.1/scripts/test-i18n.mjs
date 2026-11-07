// i18n checks: the two dictionaries must stay in lockstep.
// Run with: npm run test:i18n
//
// Everything here is static analysis - no browser, no server, no model. It fails
// when a translation is missing, when a placeholder is dropped, when the HTML asks
// for a key nobody defined, or when a key is defined but never used.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { MESSAGES } from "../src/commands.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(root, "src", "web", "app.js");
const HTML = path.join(root, "src", "web", "index.html");

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
/* Read the browser dictionary                                                */
/* -------------------------------------------------------------------------- */

const app = fs.readFileSync(APP, "utf8");
const html = fs.readFileSync(HTML, "utf8");

/** The `const I18N = { ... }` object literal, brace-matched with strings skipped. */
function extractI18n(source) {
  const start = source.indexOf("const I18N = {");
  if (start < 0) throw new Error("const I18N not found in src/web/app.js");
  const open = source.indexOf("{", start);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("the I18N object literal is not closed");
}

const dict = vm.runInNewContext(`(${extractI18n(app)})`, {});
const languages = Object.keys(dict);

/** Every `{0}`, `{1}`, ... placeholder index used by a message. */
const placeholders = (text) => [...text.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])).sort();

section("browser dictionary");
check("it has exactly en and zh", languages.join(",") === "en,zh", languages.join(","));

const en = dict.en ?? {};
const zh = dict.zh ?? {};
const enKeys = Object.keys(en).sort();
const zhKeys = Object.keys(zh).sort();

check(`en has ${enKeys.length} strings`, enKeys.length > 100, String(enKeys.length));

const missingZh = enKeys.filter((k) => !(k in zh));
const extraZh = zhKeys.filter((k) => !(k in en));
check("no key is missing from zh", missingZh.length === 0, missingZh.join(", "));
check("zh has no keys en lacks", extraZh.length === 0, extraZh.join(", "));

const empty = enKeys.filter((k) => typeof en[k] !== "string" || en[k].trim() === "");
check("every en value is a non-empty string", empty.length === 0, empty.join(", "));
const emptyZh = zhKeys.filter((k) => typeof zh[k] !== "string" || zh[k].trim() === "");
check("every zh value is a non-empty string", emptyZh.length === 0, emptyZh.join(", "));

const badPlaceholder = enKeys.filter(
  (k) => placeholders(String(en[k] ?? "")).join() !== placeholders(String(zh[k] ?? "")).join(),
);
check(
  "both languages use the same placeholders",
  badPlaceholder.length === 0,
  badPlaceholder.map((k) => `${k}: ${en[k]} | ${zh[k]}`).join(" ;; "),
);

// A placeholder that is used but never passed is a runtime "(undefined)".
const gaps = enKeys.filter((k) => {
  const used = placeholders(String(en[k]));
  return used.some((value, index) => value !== index);
});
check("placeholder numbers start at 0 and have no gaps", gaps.length === 0, gaps.join(", "));

/* -------------------------------------------------------------------------- */
/* The HTML must not ask for a key nobody defined                             */
/* -------------------------------------------------------------------------- */

section("html attributes");
const attrPattern = /data-i18n(?:-placeholder|-html|-title)?="([^"]+)"/g;
const htmlKeys = [...html.matchAll(attrPattern)].map((m) => m[1]);
check(`index.html uses ${htmlKeys.length} keys`, htmlKeys.length > 50, String(htmlKeys.length));

const unknownHtml = [...new Set(htmlKeys)].filter((k) => !(k in en) || !(k in zh));
check("every data-i18n key exists in both languages", unknownHtml.length === 0, unknownHtml.join(", "));

const pageKeys = new Set(htmlKeys);

/* -------------------------------------------------------------------------- */
/* Keys used from JavaScript                                                  */
/* -------------------------------------------------------------------------- */

section("javascript usage");
const literalKeys = [...app.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]);
check(`app.js passes ${literalKeys.length} literal keys to t()`, literalKeys.length > 30, String(literalKeys.length));

const unknownJs = [...new Set(literalKeys)].filter((k) => !(k in en) || !(k in zh));
check("every literal t() key exists in both languages", unknownJs.length === 0, unknownJs.join(", "));

// Keys chosen at runtime (setConn) and keys inside ternaries - both are real usages
// that a `t("...")` scan cannot see, so they are named here on purpose.
const dynamic = [
  "status.online",
  "status.busy",
  "status.offline",
  "settings.modeStateGuided",
  "settings.modeStateNormal",
  "settings.adminYes",
  "settings.adminNo",
  "settings.adminUnknown",
  "settings.modeGuided",
  "settings.modeNormal",
];
const dynamicUnknown = dynamic.filter((k) => !(k in en) || !(k in zh));
check("the runtime-selected keys are all defined", dynamicUnknown.length === 0, dynamicUnknown.join(", "));

// Every quoted string anywhere in app.js that looks like a dictionary key counts as
// a usage. That is deliberately generous: it can only weaken the "dead string" check,
// never report a false failure.
const candidates = new Set([...app.matchAll(/"([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]+)"/g)].map((m) => m[1]));
for (const key of pageKeys) candidates.add(key);
for (const key of dynamic) candidates.add(key);
// Template literals build a key at runtime: `context.source.${ctx.source}`.
const prefixes = [...app.matchAll(/[`"]([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9]*)\.\$\{/g)].map((m) => `${m[1]}.`);

const dead = enKeys.filter((k) => !candidates.has(k) && !prefixes.some((p) => k.startsWith(p)));
check("no dictionary string is unused", dead.length === 0, dead.join(", "));

/* -------------------------------------------------------------------------- */
/* The terminal dictionary (src/commands.ts)                                  */
/* -------------------------------------------------------------------------- */

section("terminal dictionary");
const commandEn = MESSAGES.en ?? {};
const commandZh = MESSAGES.zh ?? {};
const commandEnKeys = Object.keys(commandEn).sort();
const commandZhKeys = Object.keys(commandZh).sort();

check(`MESSAGES.en has ${commandEnKeys.length} strings`, commandEnKeys.length > 50, String(commandEnKeys.length));
const commandMissing = commandEnKeys.filter((k) => !(k in commandZh));
const commandExtra = commandZhKeys.filter((k) => !(k in commandEn));
check("no command message is missing from zh", commandMissing.length === 0, commandMissing.join(", "));
check("zh has no command messages en lacks", commandExtra.length === 0, commandExtra.join(", "));

const commandEmpty = commandEnKeys.filter(
  (k) => typeof commandEn[k] !== "string" || commandEn[k].trim() === "",
);
check("every command message is a non-empty string", commandEmpty.length === 0, commandEmpty.join(", "));

const commandPlaceholders = commandEnKeys.filter((k) => {
  const key = k;
  const left = [...String(commandEn[key]).matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])).sort();
  const right = [...String(commandZh[key] ?? "").matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])).sort();
  return left.join() !== right.join();
});
check(
  "both command languages use the same placeholders",
  commandPlaceholders.length === 0,
  commandPlaceholders.join(", "),
);

/* -------------------------------------------------------------------------- */
/* The help text must only advertise commands that exist                      */
/* -------------------------------------------------------------------------- */

section("help text");
{
  const source = fs.readFileSync(path.join(root, "src", "commands.ts"), "utf8");
  const dispatched = new Set([...source.matchAll(/case "([a-z0-9-]+)":/g)].map((m) => m[1]));
  check(`the dispatcher knows ${dispatched.size} command names`, dispatched.size > 40, String(dispatched.size));

  // "/status" but not "@scope/pkg" or "a // b".
  const advertised = [...new Set([...String(MESSAGES.en.help).matchAll(/(?:^|\s)\/([a-z][a-z-]+)/gm)].map((m) => m[1]))];
  const advertisedSet = new Set(advertised);
  check(`the English help mentions ${advertised.length} commands`, advertised.length > 30, String(advertised.length));

  const missing = advertised.filter((name) => !dispatched.has(name));
  check("every command /help advertises is implemented", missing.length === 0, missing.map((n) => `/${n}`).join(", "));

  const advertisedZh = new Set([...String(MESSAGES.zh.help).matchAll(/(?:^|\s)\/([a-z][a-z-]+)/gm)].map((m) => m[1]));
  const missingZh = [...advertisedZh].filter((name) => !dispatched.has(name));
  check("every command the Chinese help advertises is implemented", missingZh.length === 0, missingZh.join(", "));
  const onlyEn = advertised.filter((name) => !advertisedZh.has(name));
  const onlyZh = [...advertisedZh].filter((name) => !advertisedSet.has(name));
  check("both help texts document the same commands", onlyEn.length === 0 && onlyZh.length === 0, `${onlyEn.join(", ")} | ${onlyZh.join(", ")}`);

  // A command that is implemented but hidden from the help is dead weight.
  const aliases = new Set(["?", "about", "ctx", "capabilities", "doctor", "lang", "temp", "shell", "dryrun", "autoapprove", "profiles", "tokens", "convos", "convo", "skill"]);
  const undocumented = [...dispatched].filter((name) => !advertisedSet.has(name) && !aliases.has(name));
  check("every implemented command is documented (aliases excepted)", undocumented.length === 0, undocumented.join(", "));
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
