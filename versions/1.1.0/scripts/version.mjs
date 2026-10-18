// Version helper: show, bump, tag and back up a release.
//
//   node scripts/version.mjs                 print the version + whether it is backed up
//   node scripts/version.mjs --list          list the backed-up versions
//   node scripts/version.mjs --diff          what changed since the newest backup
//   node scripts/version.mjs --set 1.2.0     set the version and open a CHANGELOG section
//   node scripts/version.mjs --snapshot      back up the whole agent to versions/<version>/
//   node scripts/version.mjs --snapshot --tar   ... and also write versions/<version>.tar.gz
//   node scripts/version.mjs --tag           tag the current commit as v<version> (git)
//
// ONE VERSION = ONE FOLDER. `versions/<version>/` is a complete, standalone copy of
// the agent at that version (sources, scripts, configs, docs). node_modules, dist,
// data and other versions are never copied.
//
// `npm run release` runs the build first, then writes the folder, then tags the
// commit when this folder is a clean git repository. `--set` refuses to bump the
// version while the current one has no backup (`--force` overrides).
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const pkgPath = path.join(root, "package.json");
const changelogPath = path.join(root, "CHANGELOG.md");
const versionsDir = path.join(root, "versions");
const indexFile = path.join(versionsDir, "INDEX.md");

/** Everything that is part of the agent. Order matters only for readability. */
const SNAPSHOT_ITEMS = [
  "src",
  "scripts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  "CHANGELOG.md",
  ".env.example",
  ".gitignore",
];

/** Never copy these, even if they turn up inside a copied folder. */
const EXCLUDED = new Set(["node_modules", "dist", "data", "versions", ".git", ".cache"]);

/* -------------------------------------------------------------------------- */
/* Version number                                                             */
/* -------------------------------------------------------------------------- */

function readVersion() {
  return require(pkgPath).version;
}

function writeVersion(version) {
  const raw = fs.readFileSync(pkgPath, "utf8");
  const next = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (next === raw) throw new Error("could not find a version field in package.json");
  fs.writeFileSync(pkgPath, next, "utf8");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* CHANGELOG                                                                  */
/* -------------------------------------------------------------------------- */

/** Insert a new "## [x.y.z] — date" section under the Unreleased heading. */
function openChangelogSection(version) {
  if (!fs.existsSync(changelogPath)) {
    fs.writeFileSync(
      changelogPath,
      `# Changelog\n\n## [Unreleased]\n\n## [${version}] — ${today()}\n\n`,
      "utf8",
    );
    return;
  }
  const lines = fs.readFileSync(changelogPath, "utf8").split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith("## [Unreleased]"));
  const section = [`## [${version}] — ${today()}`, ""];
  if (at < 0) lines.unshift(...section);
  else lines.splice(at + 1, 0, "", ...section);
  fs.writeFileSync(changelogPath, lines.join("\n"), "utf8");
}

/** First paragraph under the version's CHANGELOG heading, for the index. */
function changelogSummary(version, max = 160) {
  if (!fs.existsSync(changelogPath)) return "";
  const lines = fs.readFileSync(changelogPath, "utf8").split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (at < 0) return "";
  const out = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("#") || line.startsWith("-") || line.trim() === "") {
      if (out.length > 0) break;
      continue;
    }
    out.push(line.trim());
    if (out.length >= 2) break;
  }
  const text = out.join(" ");
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/* -------------------------------------------------------------------------- */
/* Backups: one folder per version                                            */
/* -------------------------------------------------------------------------- */

function countFiles(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = countFiles(full);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  }
  return { files, bytes };
}

/** Copy the agent into versions/<version>/, replacing any earlier copy. */
function snapshot(version, { tar = false } = {}) {
  const dest = path.join(versionsDir, version);
  const existed = fs.existsSync(dest);
  if (existed) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  const copied = [];
  for (const item of SNAPSHOT_ITEMS) {
    const from = path.join(root, item);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, item);
    fs.cpSync(from, to, {
      recursive: true,
      filter: (source) => !EXCLUDED.has(path.basename(source)),
    });
    copied.push(item);
  }

  if (fs.existsSync(indexFile)) fs.copyFileSync(indexFile, path.join(dest, "INDEX.md"));

  const { files, bytes } = countFiles(dest);
  const manifest = {
    name: "win-agent",
    version,
    createdAt: new Date().toISOString(),
    node: require(pkgPath).engines?.node ?? ">=20.3",
    files,
    bytes,
    note: changelogSummary(version),
  };
  fs.writeFileSync(
    path.join(dest, "version.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (tar) {
    const archive = path.join(versionsDir, `${version}.tar.gz`);
    const result = spawnSync("tar", ["-czf", archive, "-C", versionsDir, version], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    if (result.status !== 0) console.error("warning: could not write the .tar.gz archive");
  }

  console.log(`backup  : versions/${version}/  ${existed ? "(refreshed)" : "(new)"}`);
  console.log(`content : ${copied.join(" ")}, version.json, INDEX.md`);
  console.log(`size    : ${files} files, ${(bytes / 1024).toFixed(0)} kB`);
  console.log(`restore : cd versions/${version} && npm install && npm run web`);
  return dest;
}

/** Read every agent file under `base` that belongs to a version. */
function treeFiles(base) {
  const map = new Map();
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED.has(entry.name)) continue;
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), key);
      else map.set(key, fs.readFileSync(path.join(dir, entry.name)));
    }
  };
  for (const item of SNAPSHOT_ITEMS) {
    const full = path.join(base, item);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isDirectory()) walk(full, item);
    else map.set(item, fs.readFileSync(full));
  }
  return map;
}

/** What changed in the working tree since the newest backup. */
function diffLatest() {
  const rows = listVersions();
  if (rows.length === 0) return null;
  const version = rows[0].version;
  const backed = treeFiles(path.join(versionsDir, version));
  const current = treeFiles(root);
  const changed = [];
  for (const [key, buf] of current) {
    const other = backed.get(key);
    if (!other) changed.push(`+ ${key}`);
    else if (!other.equals(buf)) changed.push(`~ ${key}`);
  }
  for (const key of backed.keys()) if (!current.has(key)) changed.push(`- ${key}`);
  return { version, changed };
}

/** Every backed-up version, newest first. */
function listVersions() {
  if (!fs.existsSync(versionsDir)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(versionsDir, entry.name, "version.json");
    if (!fs.existsSync(manifest)) continue;
    try {
      rows.push(JSON.parse(fs.readFileSync(manifest, "utf8")));
    } catch {
      /* ignore a broken manifest */
    }
  }
  return rows.sort((a, b) => String(b.version).localeCompare(String(a.version), "en", { numeric: true }));
}

/* -------------------------------------------------------------------------- */
/* git (optional): one tag per version                                        */
/* -------------------------------------------------------------------------- */

/** Find a git binary: PATH first, then the usual Windows install locations. */
function findGit() {
  const candidates = ["git"];
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "PortableGit", "cmd", "git.exe"));
  }
  candidates.push(path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd", "git.exe"));
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", shell: false });
    if (!probe.error && probe.status === 0) return { bin: candidate, version: probe.stdout.trim() };
  }
  return null;
}

/** Tag the current commit as v<version> — only for a clean repository. */
function gitTag(version) {
  const found = findGit();
  if (!found) {
    console.log("tag     : skipped (git not found)");
    return;
  }
  const run = (args) => spawnSync(found.bin, args, { cwd: root, encoding: "utf8", shell: false });
  if (run(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
    console.log("tag     : skipped (not a git repository)");
    return;
  }
  const dirty = run(["status", "--porcelain"]).stdout.trim();
  if (dirty) {
    const count = dirty.split("\n").length;
    console.log(`tag     : skipped - ${count} uncommitted change(s); commit first, then npm run tag`);
    return;
  }
  const tagName = `v${version}`;
  if (run(["rev-parse", "-q", "--verify", `refs/tags/${tagName}`]).status === 0) {
    console.log(`tag     : ${tagName} already exists`);
    return;
  }
  const made = run(["tag", "-a", tagName, "-m", `win-agent ${version}`]);
  console.log(
    made.status === 0
      ? `tag     : ${tagName}  (${found.version})`
      : `tag     : failed (git tag exited with ${made.status})`,
  );
}

/** One line: branch, HEAD, whether this version is tagged, tree cleanliness. */
function gitSummary(version) {
  const found = findGit();
  if (!found) return "git     : not available (git --version failed)";
  const run = (args) => spawnSync(found.bin, args, { cwd: root, encoding: "utf8", shell: false });
  if (run(["rev-parse", "--is-inside-work-tree"]).status !== 0) return "git     : not a git repository";
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim() || "(no commits)";
  const sha = run(["rev-parse", "--short", "HEAD"]).stdout.trim();
  const tagged = run(["rev-parse", "-q", "--verify", `refs/tags/v${version}`]).status === 0;
  const dirty = run(["status", "--porcelain"]).stdout.split("\n").filter((line) => line.trim()).length;
  const state = dirty === 0 ? "clean" : `${dirty} uncommitted file(s)`;
  return `git     : ${branch}${sha ? ` ${sha}` : ""} | tag v${version}: ${tagged ? "yes" : "no"} | ${state}`;
}

/** Rewrite versions/INDEX.md so the folder is self-explanatory. */
function writeIndex() {
  const rows = listVersions();
  const lines = [
    "# win-agent versions",
    "",
    "One version = one folder. `versions/<version>/` is a complete copy of the agent at",
    "that version: sources, scripts, configs and docs. `node_modules`, `dist`, `data`",
    "and earlier versions are never copied.",
    "",
    "每个版本一个文件夹，里面是这个版本的完整 agent（源码、脚本、配置、文档）；",
    "不含 node_modules、dist、data，也不含其他版本。",
    "",
    "## Restore a version",
    "",
    "```powershell",
    "cd versions\\1.1.0",
    "npm install",
    "npm run web          # or: npm run build && node dist/server.js --no-open",
    "```",
    "",
    "Settings and conversations live in the working folder's `data/` folder (or",
    "`AGENT_DATA_DIR`), so a restored copy starts clean unless you copy",
    "`data/settings.json` over to it (it contains your API keys).",
    "",
    "Each release is also a git tag (`git show v1.1.0`, `git checkout v1.1.0`).",
    "",
    "## Versions",
    "",
    "| Version | Backed up | Files | Note |",
    "| --- | --- | --- | --- |",
  ];
  if (rows.length === 0) lines.push("| *none yet* | | | run `npm run release` |");
  for (const row of rows) {
    const when = String(row.createdAt ?? "").replace("T", " ").slice(0, 16);
    lines.push(`| ${row.version} | ${when} | ${row.files ?? "?"} | ${row.note || ""} |`);
  }
  lines.push("", "Written by `npm run release` (`scripts/version.mjs`).", "");
  fs.mkdirSync(versionsDir, { recursive: true });
  fs.writeFileSync(indexFile, lines.join("\n"), "utf8");
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const current = readVersion();

if (args.includes("--diff")) {
  const diff = diffLatest();
  if (!diff) console.log("backups : (none yet - run npm run release)");
  else if (diff.changed.length === 0) console.log(`diff    : the working tree is identical to versions/${diff.version}/`);
  else {
    console.log(`diff    : ${diff.changed.length} file(s) differ from versions/${diff.version}/`);
    for (const line of diff.changed) console.log(`  ${line}`);
  }
  process.exit(0);
}

if (args.includes("--list")) {
  const rows = listVersions();
  console.log(`version : ${current}`);
  if (rows.length === 0) console.log("backups : (none yet - run npm run release)");
  else {
    console.log(`backups : ${rows.length}`);
    for (const row of rows) {
      console.log(`  ${row.version}  ${String(row.createdAt).replace("T", " ").slice(0, 16)}  ${row.files} files`);
    }
  }
  process.exit(0);
}

const setIndex = args.indexOf("--set");
if (setIndex >= 0) {
  const next = args[setIndex + 1];
  if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
    console.error("usage: node scripts/version.mjs --set 1.2.0");
    process.exit(1);
  }
  const previous = current;
  if (!args.includes("--force") && !fs.existsSync(path.join(versionsDir, previous))) {
    console.error(`refusing to bump: ${previous} has not been backed up yet.`);
    console.error(`backup  : npm run release   (writes versions/${previous}/)`);
    console.error(`override: node scripts/version.mjs --set ${next} --force`);
    process.exit(1);
  }
  writeVersion(next);
  openChangelogSection(next);
  console.log(`version : ${previous} -> ${next}`);
  console.log(`next    : describe the change under "[${next}]" in CHANGELOG.md`);
  console.log(`commit  : git add -A && git commit -m "release ${next}"`);
  console.log(`backup  : npm run release   (builds, writes versions/${next}/, tags v${next})`);
} else {
  console.log(`version : ${current}`);
  const rows = listVersions();
  console.log(
    rows.length === 0
      ? "backups : (none yet - run npm run release)"
      : `backups : ${rows.map((row) => row.version).join(", ")}`,
  );
  const diff = diffLatest();
  if (diff !== null) {
    console.log(
      diff.changed.length === 0
        ? `changes : none - the working tree matches versions/${diff.version}/`
        : `changes : ${diff.changed.length} file(s) differ from versions/${diff.version}/ (npm run version:diff)`,
    );
  }
  console.log(gitSummary(current));
}

if (args.includes("--tag")) {
  console.log(`version : ${current}`);
  gitTag(current);
  process.exit(0);
}

if (args.includes("--snapshot")) {
  const version = readVersion();
  const dest = snapshot(version, { tar: args.includes("--tar") });
  writeIndex();
  fs.copyFileSync(indexFile, path.join(dest, "INDEX.md"));
  gitTag(version);
} else if (listVersions().length === 0) {
  console.log(`tip     : ${current} has no backup yet - run "npm run release" (writes versions/${current}/)`);
}
