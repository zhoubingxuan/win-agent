// The documentation must match the code. Nothing here needs a model, a server or
// Windows: it compares the README/CHANGELOG/examples against the source.
// Run with: npm run test:docs
//
// What it locks down:
//   - every HTTP route the server answers is documented, and every route the README
//     documents exists
//   - every settings key in the reference table is a real setting, and every real
//     setting is in the table
//   - every `/command` in the README's tables is implemented
//   - every relative link and every `#anchor` resolves
//   - every AGENT_* environment variable that is documented exists in the source
//   - every file in examples/ is listed in examples/README.md
//   - the `.AGREEMENT` file is in the root, in every versions/<version>/ folder, and
//     in the snapshot list, so no released copy can quietly drop it
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "../src/settings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

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

const readme = read("README.md");
const serverSource = read("src/server.ts");
const settingsSource = read("src/settings.ts");
const commandsSource = read("src/commands.ts");

/** Source of every .ts file, for existence checks. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "versions" || entry.name === "dist") continue;
      walk(rel, out);
    } else if (/\.(ts|mjs|js|json|md)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}
const allSource = walk("src").map((rel) => read(rel)).join("\n");

/* -------------------------------------------------------------------------- */
/* HTTP API                                                                   */
/* -------------------------------------------------------------------------- */

section("HTTP API");
{
  const documented = [...readme.matchAll(/^\| `(GET|POST)` \| `(\/[^`]*)`/gm)].map(
    (m) => `${m[1]} ${m[2].split("?")[0].split("#")[0].trim()}`,
  );
  check(`the README documents ${documented.length} routes`, documented.length >= 20, String(documented.length));

  const implemented = [...serverSource.matchAll(/case "((?:GET|POST|DELETE) \/api\/[a-z/]+)":/g)].map((m) => m[1]);
  const implementedSet = new Set(implemented);
  check(`the server answers ${implemented.length} API routes`, implemented.length >= 20, String(implemented.length));

  const undocumented = implemented.filter((route) => !documented.includes(route));
  check("every implemented route is documented", undocumented.length === 0, undocumented.join(", "));

  const unbuilt = documented.filter((route) => !implementedSet.has(route));
  check("every documented route is implemented", unbuilt.length === 0, unbuilt.join(", "));
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

section("settings reference");
{
  const keys = new Set(Object.keys(DEFAULTS));
  // Only the rows of the settings table (they all have a Type column with a pipe).
  const tableStart = readme.indexOf("## Settings reference");
  const tableEnd = readme.indexOf("`model`, `baseUrl` and `apiKey` are a mirror", tableStart);
  const table = readme.slice(tableStart, tableEnd);
  const documentedKeys = [...new Set([...table.matchAll(/^\| `([a-zA-Z][a-zA-Z0-9]*)` \|/gm)].map((m) => m[1]))];

  check(`the reference table lists ${documentedKeys.length} settings`, documentedKeys.length >= 25, String(documentedKeys.length));
  check(`${keys.size} settings exist in the code`, keys.size >= 25, String(keys.size));

  const missing = [...keys].filter((key) => !documentedKeys.includes(key));
  check("every setting is in the table", missing.length === 0, missing.join(", "));

  const phantom = documentedKeys.filter((key) => !keys.has(key) && key !== "key");
  check("every documented key is a real setting", phantom.length === 0, phantom.join(", "));

  // A row's default should look like the real one for the simple cases.
  const boolDefaults = [...table.matchAll(/^\| `([a-zA-Z][a-zA-Z0-9]*)` \| boolean \| `(true|false)` \|/gm)];
  const wrong = boolDefaults.filter(([, key, value]) => String(DEFAULTS[key]) !== value);
  check("documented boolean defaults match the code", wrong.length === 0, wrong.map(([, k, v]) => `${k}=${v}`).join(", "));
  const numberDefaults = [...table.matchAll(/^\| `([a-zA-Z][a-zA-Z0-9]*)` \| number \| `([0-9]+)` \|/gm)];
  const wrongNumbers = numberDefaults.filter(([, key, value]) => String(DEFAULTS[key]) !== value);
  check("documented number defaults match the code", wrongNumbers.length === 0, wrongNumbers.map(([, k, v]) => `${k}=${v}`).join(", "));
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

section("internal commands");
{
  const dispatched = new Set([...commandsSource.matchAll(/case "([a-z0-9-]+)":/g)].map((m) => m[1]));
  const aliases = new Set(["?", "about", "ctx", "capabilities", "doctor", "lang", "temp", "shell", "dryrun", "autoapprove", "profiles", "tokens", "convos", "convo", "exec", "skill"]);
  // "/status", "/set", and "/enable <name...>" inside a row - but "/api/state"
  // (a route, excluded by the lookahead) or the word "/command" in prose are not
  // commands.
  const notCommands = new Set(["command", "api"]);
  const advertised = [
    ...new Set(
      [...readme.matchAll(/^\|.*$/gm)]
        .flatMap((line) => [...line[0].matchAll(/`\/([a-z][a-z0-9-]*)(?![\w/-])/g)])
        .map((m) => m[1])
        .filter((name) => !notCommands.has(name)),
    ),
  ];
  check(`the README documents ${advertised.length} commands`, advertised.length >= 30, String(advertised.length));
  const missing = advertised.filter((name) => !dispatched.has(name));
  check("every documented command is implemented", missing.length === 0, missing.map((n) => `/${n}`).join(", "));

  const undocumented = [...dispatched].filter((name) => !advertised.includes(name) && !aliases.has(name));
  check("every implemented command is documented", undocumented.length === 0, undocumented.join(", "));
}

/* -------------------------------------------------------------------------- */
/* Environment variables                                                      */
/* -------------------------------------------------------------------------- */

section("environment variables");
{
  const docs = ["README.md", "examples/settings.md", "examples/api.md", "examples/windows.md", "examples/modes.md"]
    .map((rel) => read(rel))
    .join("\n");
  const mentioned = [...new Set([...docs.matchAll(/AGENT_[A-Z0-9_]+/g)].map((m) => m[0]))];
  check(`the docs mention ${mentioned.length} AGENT_* variables`, mentioned.length >= 3, String(mentioned.length));
  const unknown = mentioned.filter((name) => !allSource.includes(name));
  check("every documented AGENT_* variable exists in the source", unknown.length === 0, unknown.join(", "));

  const inSource = [...new Set([...allSource.matchAll(/env\.(AGENT_[A-Z0-9_]+)/g)].map((m) => m[1]))];
  const hidden = inSource.filter((name) => !mentioned.includes(name));
  // AGENT_SETTINGS_FILE / AGENT_DATA_DIR are explained in the data-folder section.
  check("no environment variable is undocumented", hidden.length === 0, hidden.join(", "));
}

/* -------------------------------------------------------------------------- */
/* Links                                                                      */
/* -------------------------------------------------------------------------- */

section("links");
{
  /** GitHub's heading slug: lowercase, drop punctuation, spaces to dashes. */
  const slug = (heading) =>
    heading
      .toLowerCase()
      .replace(/`/g, "")
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s/g, "-");

  const headings = (markdown) =>
    [...markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1]));

  const files = ["README.md", "CHANGELOG.md", "examples/README.md", ...fs.readdirSync(path.join(root, "examples")).filter((f) => f.endsWith(".md")).map((f) => `examples/${f}`)];
  const bad = [];
  const badAnchor = [];
  let total = 0;

  for (const file of new Set(files)) {
    const text = read(file);
    const base = path.dirname(path.join(root, file));
    const own = headings(text);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target) && !target.startsWith("#")) continue;
      total += 1;
      const [linkPath, fragment] = target.split("#");
      if (linkPath) {
        const resolved = path.resolve(base, decodeURIComponent(linkPath));
        if (!fs.existsSync(resolved)) {
          bad.push(`${file} -> ${target}`);
          continue;
        }
        if (fragment && resolved.endsWith(".md")) {
          const targetHeadings = resolved === path.join(root, file) ? own : headings(fs.readFileSync(resolved, "utf8"));
          if (!targetHeadings.includes(decodeURIComponent(fragment))) {
            badAnchor.push(`${file} -> ${target}`);
          }
        }
      } else if (fragment && !own.includes(decodeURIComponent(fragment))) {
        badAnchor.push(`${file} -> ${target}`);
      }
    }
  }

  check(`${total} relative links point at a real file`, bad.length === 0, bad.join(", "));
  check("every #anchor points at a real heading", badAnchor.length === 0, badAnchor.join(", "));
}

/* -------------------------------------------------------------------------- */
/* Examples                                                                   */
/* -------------------------------------------------------------------------- */

section("examples");
{
  const index = read("examples/README.md");
  const files = fs.readdirSync(path.join(root, "examples")).filter((f) => f.endsWith(".md") && f !== "README.md");
  const unlisted = files.filter((f) => !index.includes(`(${f})`));
  check(`all ${files.length} example files are listed in examples/README.md`, unlisted.length === 0, unlisted.join(", "));

  const versions = read("versions/INDEX.md");
  const folders = fs.readdirSync(path.join(root, "versions"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const missing = folders.filter((name) => !new RegExp(`^\\| ${name.replace(/\./g, "\\.")} \\|`, "m").test(versions));
  check(`versions/INDEX.md lists all ${folders.length} version folders`, missing.length === 0, missing.join(", "));

  // The CHANGELOG must have a section for the current version.
  const version = JSON.parse(read("package.json")).version;
  check(`CHANGELOG.md documents ${version}`, read("CHANGELOG.md").includes(`## [${version}]`), version);
}

/* -------------------------------------------------------------------------- */
/* Attribution                                                                */
/* -------------------------------------------------------------------------- */

section("attribution");
{
  const file = path.join(root, ".AGREEMENT");
  const agreement = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  check("the agreement file exists", agreement.length > 0, ".AGREEMENT");
  check(
    "the agreement names the author and the license",
    agreement.includes("zhoubingxuan") && agreement.includes("Apache License, Version 2.0"),
  );
  check("NOTICE points at the agreement", read("NOTICE").includes(".AGREEMENT"));

  const folders = fs
    .readdirSync(path.join(root, "versions"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const copies = folders.map((name) => path.join(root, "versions", name, ".AGREEMENT"));
  const missing = folders.filter((_, i) => !fs.existsSync(copies[i]));
  check(`all ${folders.length} version folders carry the agreement`, missing.length === 0, missing.join(", "));
  const stale = folders.filter((_, i) => fs.existsSync(copies[i]) && fs.readFileSync(copies[i], "utf8") !== agreement);
  check("every version folder has the same agreement as the root", stale.length === 0, stale.join(", "));

  // A new snapshot has to pick it up: it must be in the list `--snapshot` copies.
  const versionSource = read("scripts/version.mjs");
  const listStart = versionSource.indexOf("const SNAPSHOT_ITEMS");
  const list = versionSource.slice(listStart, versionSource.indexOf("]", listStart));
  check("the snapshot list carries .AGREEMENT into new versions", list.includes(".AGREEMENT"));
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
