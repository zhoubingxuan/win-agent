// Skills: the folder, the header block, the index in the prompt and the tool.
// Run with: npm run test:skills
//
// No model and no Windows here - a skill is text, and the tool only reads it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-skills-"));
process.env.AGENT_DATA_DIR = path.join(root, "data");

const skills = await import("../src/skills.js");
const { createWindowsTools } = await import("../src/tools/index.js");

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

try {
  /* ---------------------------------------------------------------------- */
  section("the folder");
  {
    skills.ensureSkillsFolder();
    const dir = skills.skillsDir();
    check("the folder is under data/", dir === path.join(process.env.AGENT_DATA_DIR, "skills"), dir);
    check("it exists", fs.existsSync(dir));
    check("with a README that explains the format", /SKILL\.md/.test(fs.readFileSync(path.join(dir, "README.md"), "utf8")));
    check("and it is empty to begin with", skills.listSkills().length === 0);
    check("the index is empty, so the prompt does not grow", skills.skillIndex() === "");
  }

  /* ---------------------------------------------------------------------- */
  section("the header block");
  {
    const plain = skills.parseSkill("---\nname: x\ndescription: \"does a thing\"\nwhen: the user asks\n---\n\n# Steps\n1. go\n");
    check("front matter is parsed", plain.meta.name === "x" && plain.meta.description === "does a thing");
    check("quotes are stripped from the value", plain.meta.description === "does a thing");
    check("the body starts after the header", plain.body === "# Steps\n1. go", JSON.stringify(plain.body));

    const crlf = skills.parseSkill("\uFEFF---\r\nname: y\r\nwhen_to_use: sometimes\r\n---\r\nbody\r\n");
    check("a BOM and CRLF do not break it", crlf.meta.name === "y" && crlf.body === "body");
    check("`when_to_use` is accepted for `when`", crlf.meta.when_to_use === "sometimes");

    const noHeader = skills.parseSkill("# Just steps\n2. do it\n");
    check("a skill without a header still has a body", noHeader.body.startsWith("# Just steps") && Object.keys(noHeader.meta).length === 0);
  }

  /* ---------------------------------------------------------------------- */
  section("saving and listing");
  {
    const saved = skills.saveSkill({
      name: "Clean Temp",
      description: "Find old files in %TEMP% and remove them safely",
      when: "The user asks to free up disk space",
      body: "# Clean the temp folder\n1. list, 2. count, 3. ask, 4. remove",
    });
    check("the name becomes a folder-safe slug", saved.name === "Clean-Temp", saved.name);
    check("the folder has a SKILL.md", fs.existsSync(path.join(saved.dir, "SKILL.md")));
    const text = fs.readFileSync(path.join(saved.dir, "SKILL.md"), "utf8");
    check("the header is written back", /^---\nname: Clean-Temp\n/.test(text), text.slice(0, 80));
    check("with the description and the when", /description: Find old files/.test(text) && /when: The user asks/.test(text));

    const listed = skills.listSkills();
    check("it is listed once", listed.length === 1, String(listed.length));
    check("with its description", listed[0].description === "Find old files in %TEMP% and remove them safely");
    check("with when to use it", listed[0].when === "The user asks to free up disk space");
    check("and its files", listed[0].files.includes("SKILL.md"));
    check("finding it ignores case", skills.findSkill("clean-temp")?.name === "Clean-Temp");
    check("an unknown name finds nothing", skills.findSkill("nope") === null);

    const index = skills.skillIndex();
    check("the index has one line per skill", index.split("\n").filter((line) => line.startsWith("- ")).length === 1, index);
    check("the index says when to use it", index.includes("when: The user asks to free up disk space"));
    check("the index points at the tool", /`skills` tool/.test(index));
    check("the index does not carry the body", !index.includes("1. list, 2. count"));

    const loaded = skills.loadSkill("Clean-Temp");
    check("loading returns the body without the header", typeof loaded !== "string" && loaded.body.startsWith("# Clean the temp folder"));
    check("a missing skill says what exists", /Available: Clean-Temp/.test(String(skills.loadSkill("other"))));
  }

  /* ---------------------------------------------------------------------- */
  section("files next to SKILL.md");
  {
    const skill = skills.findSkill("Clean-Temp");
    fs.writeFileSync(path.join(skill.dir, "examples.txt"), "an example\n", "utf8");
    fs.writeFileSync(path.join(root, "secret.txt"), "outside\n", "utf8");
    check("a sibling file is readable", skills.readSkillFile("Clean-Temp", "examples.txt") === "an example\n");
    check("a parent path is refused", /^Refused:/.test(skills.readSkillFile("Clean-Temp", "../secret.txt")));
    check("an absolute path is refused", /^Refused:/.test(skills.readSkillFile("Clean-Temp", path.join(root, "secret.txt"))));
    check("a missing file lists what is there", /no file "nope.txt"/.test(skills.readSkillFile("Clean-Temp", "nope.txt")));
    check("a new sibling shows up in the file list", skills.findSkill("Clean-Temp").files.includes("examples.txt"));
  }

  /* ---------------------------------------------------------------------- */
  section("what a skill may not be");
  {
    check("an empty name is rejected", throws(() => skills.saveSkill({ name: "   ", body: "x" })));
    check("a name made only of dots is rejected", throws(() => skills.saveSkill({ name: "..", body: "x" })));
    check("an empty body is rejected", throws(() => skills.saveSkill({ name: "empty", body: "  " })));
    const slug = skills.safeSkillName('a/b:c*?"<>|d');
    check("reserved characters are replaced", !/[\\/:*?"<>|]/.test(slug), slug);

    const broken = path.join(skills.skillsDir(), "broken");
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, "SKILL.md"), "---\nname: broken\n---\n", "utf8");
    const entry = skills.findSkill("broken");
    check("an empty SKILL.md is reported, not hidden", Boolean(entry?.problem), JSON.stringify(entry));
    check("and it is left out of the prompt index", !skills.skillIndex().includes("broken:"));
    check("the description falls back to something readable", entry?.description === "(no description)", entry?.description);
  }

  /* ---------------------------------------------------------------------- */
  section("the model's side: the skills tool");
  {
    const tools = createWindowsTools(async () => true);
    check("the tool is offered", tools.names().includes("skills"));
    check("its description says when to use it", /procedure/i.test(tools.describe()));

    const list = await tools.execute("skills", JSON.stringify({ action: "list" }));
    check("list shows the good skill", /Clean-Temp: Find old files/.test(list), list);
    check("list shows the file next to it", /examples\.txt/.test(list));
    check("list flags the broken one", /problem: the body is empty/.test(list), list);

    const loaded = await tools.execute("skills", JSON.stringify({ action: "load", name: "clean-temp" }));
    check("load returns the steps", /# Clean the temp folder/.test(loaded));
    check("load points at the other files", /examples\.txt/.test(loaded));

    const read = await tools.execute("skills", JSON.stringify({ action: "read", name: "Clean-Temp", path: "examples.txt" }));
    check("read returns the file", read === "an example\n");
    const escape = await tools.execute("skills", JSON.stringify({ action: "read", name: "Clean-Temp", path: "../secret.txt" }));
    check("read cannot leave the skill folder", /^Refused:/.test(escape), escape);

    const unknown = await tools.execute("skills", JSON.stringify({ action: "explode" }));
    check("an unknown action lists the real ones", /list, load, read/.test(unknown), unknown);
    check("the action defaults to list", /Clean-Temp/.test(await tools.execute("skills", "{}")));
    check("a load without a name is an error, not a crash", /Error:/.test(await tools.execute("skills", JSON.stringify({ action: "load" }))));
  }

  /* ---------------------------------------------------------------------- */
  section("deleting");
  {
    check("an unknown skill cannot be deleted", skills.deleteSkill("nope") === false);
    const dir = skills.findSkill("Clean-Temp").dir;
    check("deleting reports success", skills.deleteSkill("Clean-Temp") === true);
    check("the folder is gone", !fs.existsSync(dir));
    check("and the list is one shorter", !skills.listSkills().some((skill) => skill.name === "Clean-Temp"));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
