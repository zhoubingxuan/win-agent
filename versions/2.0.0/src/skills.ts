import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./store.js";
import { isInside } from "./sandbox.js";

/**
 * Skills: small, user-written procedures the agent can load on demand.
 *
 * A skill is a folder under `data/skills/` with a `SKILL.md` in it:
 *
 *     ---
 *     name: clean-temp
 *     description: Find old files in %TEMP% and remove them safely
 *     when: The user asks to free up disk space or clean temporary files
 *     ---
 *     # Clean the temp folder
 *     1. `files list` in $env:TEMP ...
 *
 * The point is the one thing a small model cannot do: keep a long procedure out of
 * the system prompt until it is needed. The prompt carries one line per skill (with
 * *when* to use it); the body is fetched with the `skills` tool when the model says
 * "this one". That keeps a dozen procedures from eating a 4 000-token window.
 *
 * Two deliberate choices:
 *  - a skill is **text**, not code. It is advice for the model; every tool call it
 *    leads to still goes through the same approvals, sandbox and audit log. A skill
 *    cannot grant itself anything;
 *  - the folder is the source of truth. There is no database, so a user can add a
 *    skill with Explorer, a text editor, or the web UI - all three write a file.
 */

/** The one file that makes a folder a skill. */
const SKILL_FILE = "SKILL.md";

/** A skill as the index (and the UI) sees it. */
export interface Skill {
  /** The folder name: the stable id the model calls `load` with. */
  name: string;
  /** One line for the index. */
  description: string;
  /** When the model should reach for it ("the user asks about ..."). */
  when: string;
  /** Absolute folder. */
  dir: string;
  /** Every file in the folder, relative to it (SKILL.md included). */
  files: string[];
  /** Set when the folder has a SKILL.md that could not be read or parsed. */
  problem?: string;
}

/** Where skills live. */
export function skillsDir(): string {
  return path.join(dataDir(), "skills");
}

/** Create the folder (and explain it) on first use. */
export function ensureSkillsFolder(): void {
  const dir = skillsDir();
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme)) {
    const text = [
      "# Skills / 鎶€鑳藉寘",
      "",
      "One folder per skill, each with a SKILL.md:",
      "",
      "    data/skills/clean-temp/SKILL.md",
      "",
      "SKILL.md starts with a header block between --- lines:",
      "",
      "    ---",
      "    name: clean-temp",
      "    description: Find old files in %TEMP% and remove them safely",
      "    when: The user asks to free up disk space or clean temporary files",
      "    ---",
      "    # Steps",
      "    1. ...",
      "",
      "The agent sees one line per skill (name + description + when) and loads the",
      "whole file only when it is relevant, with the `skills` tool. Files next to",
      "SKILL.md can be loaded too (`skills read`), so long examples can live in their",
      "own file.",
      "",
      "A skill is text, not code: it cannot give itself permissions, and every tool",
      "call it suggests still goes through approvals, the sandbox and the audit log.",
      "",
    ].join("\n");
    try {
      fs.writeFileSync(readme, text, "utf8");
    } catch {
      // a read-only data folder is not a reason to fail
    }
  }
}

/** Strip quotes/whitespace a hand-written header value may carry. */
function cleanValue(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Split the `---` header from the body. Tolerant on purpose: a skill without a
 * header still works (the folder name and the first line are used), because a
 * user writing their first one should not have to learn a format first.
 */
export function parseSkill(text: string): { meta: Record<string, string>; body: string } {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { meta: {}, body: normalized.trim() };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (pair) meta[pair[1].toLowerCase()] = cleanValue(pair[2]);
  }
  return { meta, body: normalized.slice(match[0].length).replace(/^\n+/, "").trim() };
}

/** The first heading or sentence, for a skill that has no `description`. */
function firstLine(body: string): string {
  const line = body
    .split("\n")
    .map((entry) => entry.replace(/^#+\s*/, "").trim())
    .find((entry) => entry.length > 0);
  return (line ?? "").slice(0, 140);
}

/** Files in a skill folder, sorted, relative, never leaving the folder. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel, depth + 1);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk(dir, "", 0);
  return out.sort();
}

/**
 * Every skill in the folder, alphabetically.
 *
 * No cache on purpose: `describe()` runs once per turn and the folder holds a handful
 * of small files, so reading it costs about a millisecond - and a file the user drops
 * into a skill folder is visible on the next call instead of "after a restart".
 */
export function listSkills(): Skill[] {
  const root = skillsDir();
  const skills: Skill[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const file = path.join(dir, SKILL_FILE);
    if (!fs.existsSync(file)) continue;
    let body = "";
    let meta: Record<string, string> = {};
    let problem: string | undefined;
    try {
      const parsed = parseSkill(fs.readFileSync(file, "utf8"));
      meta = parsed.meta;
      body = parsed.body;
      if (!body) problem = "the body is empty";
    } catch (error) {
      problem = `could not read SKILL.md (${(error as Error).message})`;
    }
    skills.push({
      name: entry.name,
      description: meta.description || firstLine(body) || "(no description)",
      when: meta.when || meta.when_to_use || "",
      dir,
      files: listFiles(dir),
      ...(problem ? { problem } : {}),
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/** One skill by folder name (case-insensitive, so a model's casing does not matter). */
export function findSkill(name: string): Skill | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return listSkills().find((skill) => skill.name.toLowerCase() === wanted) ?? null;
}

/** The body of a skill, or a refusal that says what exists. */
export function loadSkill(name: string): { skill: Skill; body: string } | string {
  const skill = findSkill(name);
  if (!skill) {
    const known = listSkills().map((entry) => entry.name);
    return known.length > 0
      ? `Error: no skill "${name}". Available: ${known.join(", ")}`
      : `Error: no skills are installed yet (add one under ${skillsDir()})`;
  }
  try {
    const text = fs.readFileSync(path.join(skill.dir, SKILL_FILE), "utf8");
    const { body } = parseSkill(text);
    return { skill, body: body || "(this skill has no body)" };
  } catch (error) {
    return `Error: could not read ${path.join(skill.dir, SKILL_FILE)}: ${(error as Error).message}`;
  }
}

/**
 * One file next to SKILL.md, confined to the skill's own folder: a skill can point
 * at its examples, but not at `..\..\settings.json`.
 */
export function readSkillFile(name: string, relative: string): string {
  const skill = findSkill(name);
  if (!skill) return `Error: no skill "${name}"`;
  const target = path.resolve(skill.dir, relative);
  if (relative.trim() === "" || !isInside(skill.dir, target)) {
    return `Refused: ${relative} is outside the skill folder (${skill.dir})`;
  }
  let real = target;
  try {
    real = fs.realpathSync(target);
  } catch {
    return `Error: no file "${relative}" in the skill "${skill.name}". Files: ${skill.files.join(", ")}`;
  }
  if (!isInside(fs.realpathSync(skill.dir), real)) {
    return `Refused: ${relative} resolves outside the skill folder (${skill.dir})`;
  }
  try {
    const text = fs.readFileSync(real, "utf8");
    const CAP = 100_000;
    return text.length > CAP ? `${text.slice(0, CAP)}\n... (${text.length - CAP} characters trimmed)` : text;
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

/** A folder-safe name: no path separators, no reserved characters, not too long. */
export function safeSkillName(raw: string): string {
  const name = raw
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 60);
  if (!name || name === "." || name === "..") {
    throw new Error("a skill needs a name (letters, numbers, dashes)");
  }
  return name;
}

export interface SkillInput {
  name: string;
  description?: string;
  when?: string;
  body: string;
}

/**
 * Create or replace a skill. The file is written with the header normalised, so
 * the list and the model always agree about what it is called and when it applies.
 */
export function saveSkill(input: SkillInput): Skill {
  ensureSkillsFolder();
  const name = safeSkillName(input.name);
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!body) throw new Error("a skill needs a body (the steps to follow)");
  const description = cleanValue(input.description ?? "") || firstLine(body);
  const when = cleanValue(input.when ?? "");
  const dir = path.join(skillsDir(), name);
  fs.mkdirSync(dir, { recursive: true });
  const header = ["---", `name: ${name}`, `description: ${description}`];
  if (when) header.push(`when: ${when}`);
  header.push("---", "");
  fs.writeFileSync(path.join(dir, SKILL_FILE), `${header.join("\n")}${body}\n`, "utf8");
  return findSkill(name) as Skill;
}

/** Remove a skill folder (the whole thing, not just the file). */
export function deleteSkill(name: string): boolean {
  const skill = findSkill(name);
  if (!skill) return false;
  fs.rmSync(skill.dir, { recursive: true, force: true });
  return true;
}

/**
 * The block the system prompt carries: one line per skill, and the instruction
 * that makes a small model actually use it. Empty when there are no skills.
 */
export function skillIndex(): string {
  const skills = listSkills().filter((skill) => !skill.problem);
  if (skills.length === 0) return "";
  const lines = [
    "Skills (procedures you can load when they fit; call the `skills` tool with action \"load\"):",
  ];
  for (const skill of skills) {
    const when = skill.when ? ` - when: ${skill.when}` : "";
    lines.push(`- ${skill.name}: ${skill.description}${when}`);
  }
  lines.push(
    "Load a skill before starting a task it covers; it is written as steps for you to follow with the normal tools.",
  );
  return lines.join("\n");
}
