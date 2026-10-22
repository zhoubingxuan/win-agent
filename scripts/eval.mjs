#!/usr/bin/env node
// Real-model evaluation: 26 small jobs, run through the real HTTP server, the real
// tools and the real prompts, then checked by looking at the machine - not at what
// the model said it did.
//
// The test suites answer "is the code right?". This answers "can a model actually
// do the job?", which is the other half of the product. It exists so a version can
// say "25/26, was 21/26" instead of "feels better".
//
// Run with: npm run eval                       (uses settings.json's model/baseUrl)
//           npm run eval -- --model qwen/qwen3.8-27b
//           npm run eval -- --only write_exact,edit_replace --verbose
//           npm run eval -- --self-check       (no model: proves every check can
//                                               fail and pass, used by test-eval)
//
// What it does per task:
//   1. resets the conversation and creates <workdir>/<task-id>/
//   2. seeds that folder with whatever the task needs
//   3. sends the prompt through POST /api/chat and waits for the turn to end
//   4. runs the task's own check against the folder (and, for answer tasks, the
//      final assistant reply)
//
// It writes nothing outside a temp folder; the sandbox is on, so a model that
// wanders gets refused instead of touching your files. Results are printed and
// saved to data/eval/<timestamp>.json (data/ is git-ignored).
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* -------------------------------------------------------------------------- */
/* Task definitions                                                           */
/* -------------------------------------------------------------------------- */

const norm = (text) => String(text ?? "").replace(/\r\n/g, "\n");
const lines = (text) => norm(text).trim().split("\n").map((line) => line.trim());
const has = (text, ...needles) => needles.some((needle) => String(text ?? "").toLowerCase().includes(String(needle).toLowerCase()));

/** Write a seed file (with its folders) into the task folder. */
function seed(dir, rel, text) {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
}

/** Read a file in the task folder, or null. */
function read(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
}

function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel));
}

/**
 * One task. `setup` seeds the folder, `solve` is what a correct agent would do (only
 * the self-check uses it), `check` gets the folder and the final answer and decides.
 */
const TASKS = [
  {
    id: "write_exact",
    title: "write a file with exact content",
    prompt: "在子文件夹 `write_exact/` 里创建 a.txt，内容必须恰好是这一行：hello win-agent（末尾有一个换行）。只做这一件事。",
    check: (dir) => read(dir, "a.txt") === "hello win-agent\n",
    solve: (dir) => seed(dir, "a.txt", "hello win-agent\n"),
  },
  {
    id: "append_line",
    title: "append one line to an existing file",
    prompt: "b.txt 在子文件夹 `append_line/` 里，已有两行。请只做一件事：在末尾追加一行 third（不要改动前两行）。",
    setup: (dir) => seed(dir, "b.txt", "one\ntwo\n"),
    check: (dir) => JSON.stringify(lines(read(dir, "b.txt"))) === JSON.stringify(["one", "two", "third"]),
    solve: (dir) => seed(dir, "b.txt", "one\ntwo\nthird\n"),
  },
  {
    id: "edit_replace",
    title: "replace one value, leave the rest",
    prompt: "在子文件夹 `edit_replace/` 里，把 c.txt 中的 color: red 改成 color: blue。其他内容一个字都不要动。",
    setup: (dir) => seed(dir, "c.txt", "color: red\nsize: 2\n"),
    check: (dir) => JSON.stringify(lines(read(dir, "c.txt"))) === JSON.stringify(["color: blue", "size: 2"]),
    solve: (dir) => seed(dir, "c.txt", "color: blue\nsize: 2\n"),
  },
  {
    id: "mkdir_nested",
    title: "create a nested folder",
    prompt: "在子文件夹 `mkdir_nested/` 里创建两层目录：sub/deep（sub 下面再有 deep）。只做这一件事。",
    check: (dir) => fs.existsSync(path.join(dir, "sub", "deep")) && fs.statSync(path.join(dir, "sub", "deep")).isDirectory(),
    solve: (dir) => fs.mkdirSync(path.join(dir, "sub", "deep"), { recursive: true }),
  },
  {
    id: "copy_file",
    title: "copy a file",
    prompt: "在子文件夹 `copy_file/` 里，把 d.txt 复制一份，新名字叫 d-copy.txt，内容要和原来完全一样。",
    setup: (dir) => seed(dir, "d.txt", "copy me\n"),
    check: (dir) => read(dir, "d-copy.txt") === "copy me\n" && read(dir, "d.txt") === "copy me\n",
    solve: (dir) => seed(dir, "d-copy.txt", "copy me\n"),
  },
  {
    id: "move_file",
    title: "rename a file",
    prompt: "在子文件夹 `move_file/` 里，把 e.txt 改名为 e2.txt。",
    setup: (dir) => seed(dir, "e.txt", "rename me\n"),
    check: (dir) => !exists(dir, "e.txt") && read(dir, "e2.txt") === "rename me\n",
    solve: (dir) => {
      seed(dir, "e2.txt", "rename me\n");
      fs.rmSync(path.join(dir, "e.txt"), { force: true });
    },
  },
  {
    id: "delete_file",
    title: "delete the right file, keep the other",
    prompt: "在子文件夹 `delete_file/` 里，删除 f.txt。keep.txt 必须原样保留。",
    setup: (dir) => {
      seed(dir, "f.txt", "delete me\n");
      seed(dir, "keep.txt", "keep me\n");
    },
    check: (dir) => !exists(dir, "f.txt") && read(dir, "keep.txt") === "keep me\n",
    solve: (dir) => fs.rmSync(path.join(dir, "f.txt"), { force: true }),
  },
  {
    id: "read_answer",
    title: "read a file and answer a number",
    prompt: "读 `read_answer/g.txt`，告诉我本周预算的金额是多少元。只回答一个数字和单位。",
    setup: (dir) => seed(dir, "g.txt", "本周预算 1234 元，已花 200 元。\n"),
    check: (dir, answer) => has(answer, "1234"),
    solve: () => "1234 元",
  },
  {
    id: "grep_locate",
    title: "find which file contains a word",
    prompt: "在子文件夹 `grep_locate/` 里有两个文件 h1.txt 和 h2.txt。哪个文件里有 APPLE？只回答文件名。",
    setup: (dir) => {
      seed(dir, "h1.txt", "BANANA\n");
      seed(dir, "h2.txt", "APPLE PIE\n");
    },
    check: (dir, answer) => has(answer, "h2") && !has(answer, "h1"),
    solve: () => "h2.txt",
  },
  {
    id: "search_name",
    title: "find a file by name",
    prompt: "在子文件夹 `search_name/` 下面找出唯一的 .log 文件，告诉我它的文件名（不含路径）。",
    setup: (dir) => {
      seed(dir, "a/note.txt", "nothing\n");
      seed(dir, "b/k/session.log", "log line\n");
    },
    check: (dir, answer) => has(answer, "session.log"),
    solve: () => "session.log",
  },
  {
    id: "multi_write3",
    title: "three files in one turn (does it finish the list?)",
    prompt:
      "在子文件夹 `multi_write3/` 里创建三个文件，每个只写一行：\n" +
      "x1.txt 写 alpha\nx2.txt 写 beta\nx3.txt 写 gamma\n" +
      "三件都要做，全部做完再回答。",
    check: (dir) => {
      // "one line" does not promise a trailing newline; compare the text, not the bytes.
      const one = (rel) => norm(read(dir, rel)).trim();
      return one("x1.txt") === "alpha" && one("x2.txt") === "beta" && one("x3.txt") === "gamma";
    },
    solve: (dir) => {
      seed(dir, "x1.txt", "alpha\n");
      seed(dir, "x2.txt", "beta\n");
      seed(dir, "x3.txt", "gamma\n");
    },
  },
  {
    id: "multi_mixed",
    title: "edit + append + delete in one turn",
    prompt:
      "在子文件夹 `multi_mixed/` 里做三件事，全部做完再回答：\n" +
      "1) 把 j.txt 第一行的 line1 改成 first\n" +
      "2) 在 j.txt 末尾追加一行 end\n" +
      "3) 删除 j-old.txt\n" +
      "j.txt 的 line2 必须保留。",
    setup: (dir) => {
      seed(dir, "j.txt", "line1\nline2\n");
      seed(dir, "j-old.txt", "old\n");
    },
    check: (dir) =>
      JSON.stringify(lines(read(dir, "j.txt"))) === JSON.stringify(["first", "line2", "end"]) && !exists(dir, "j-old.txt"),
    solve: (dir) => {
      seed(dir, "j.txt", "first\nline2\nend\n");
      fs.rmSync(path.join(dir, "j-old.txt"), { force: true });
    },
  },
  {
    id: "json_update",
    title: "change one field in JSON",
    prompt: "在子文件夹 `json_update/` 里，把 k.json 的 port 从 8080 改成 9090，其余字段保持不变。",
    setup: (dir) => seed(dir, "k.json", '{\n  "port": 8080,\n  "host": "localhost"\n}\n'),
    check: (dir) => {
      try {
        const value = JSON.parse(read(dir, "k.json"));
        return value.port === 9090 && value.host === "localhost";
      } catch {
        return false;
      }
    },
    solve: (dir) => seed(dir, "k.json", '{\n  "port": 9090,\n  "host": "localhost"\n}\n'),
  },
  {
    id: "nested_write",
    title: "create a folder and a file inside it",
    prompt: "在子文件夹 `nested_write/` 里创建目录 out，并在 out 里创建 report.txt，内容写 ok（一行）。",
    check: (dir) => norm(read(dir, "out/report.txt")).trim() === "ok",
    solve: (dir) => seed(dir, "out/report.txt", "ok\n"),
  },
  {
    id: "count_files",
    title: "count the .txt files",
    prompt: "子文件夹 `count_files/` 里有多少个 .txt 文件？只回答数字。",
    setup: (dir) => {
      for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) seed(dir, name, "x\n");
      seed(dir, "skip.md", "not counted\n");
    },
    check: (dir, answer) => /(^|[^\d])4([^\d]|$)/.test(norm(answer)),
    solve: () => "4",
  },
  {
    id: "hash_same",
    title: "compare two files by hash",
    prompt: "用 hash 比较 `hash_same/same1.txt` 和 `hash_same/same2.txt`，内容是否相同？只回答“相同”或“不同”。",
    setup: (dir) => {
      seed(dir, "same1.txt", "same content\n");
      seed(dir, "same2.txt", "same content\n");
    },
    check: (dir, answer) =>
      /相同|一样|一致|identical|same/i.test(norm(answer)) && !/不同|不一样|不一致|different|not the same/i.test(norm(answer)),
    solve: () => "相同",
  },
  {
    id: "zip_roundtrip",
    title: "zip a folder, then unzip it elsewhere",
    prompt:
      "在子文件夹 `zip_roundtrip/` 里做两步：\n" +
      "1) 把 z 目录打包成 z.zip\n" +
      "2) 把 z.zip 解压到 z-out 目录\n" +
      "解压后要能在 z-out 里读到 inner.txt。",
    setup: (dir) => seed(dir, "z/inner.txt", "zipped\n"),
    check: (dir) => {
      // Either layout is a working unzip: the folder that was zipped may stay as a
      // top-level folder inside z-out. Both prove the archive was readable.
      const inner = read(dir, "z-out/inner.txt") ?? read(dir, "z-out/z/inner.txt");
      return norm(inner).trim() === "zipped";
    },
    solve: (dir) => {
      seed(dir, "z-out/inner.txt", "zipped\n");
      seed(dir, "z.zip", "not a real zip, only the self-check looks at z-out\n");
    },
  },
  {
    id: "utf8_write",
    title: "write Chinese text as UTF-8",
    prompt: "在子文件夹 `utf8_write/` 里创建 utf8.txt，内容恰好是这一行：中文测试：你好（末尾一个换行）。",
    check: (dir) => read(dir, "utf8.txt") === "中文测试：你好\n",
    solve: (dir) => seed(dir, "utf8.txt", "中文测试：你好\n"),
  },
  {
    id: "whoami",
    title: "answer the Windows user name",
    prompt: "我的 Windows 登录用户名是什么？用 system 工具查一下再回答，只回答用户名。",
    check: (dir, answer) => {
      const user = process.env.USERNAME ?? "";
      return user.length > 0 && norm(answer).toLowerCase().includes(user.toLowerCase());
    },
    solve: () => process.env.USERNAME ?? "",
  },
  {
    id: "disk_free",
    title: "report free space on C:",
    prompt: "C 盘还剩多少可用空间？用 system 工具查一下，回答数字加单位（GB）。",
    check: (dir, answer) => /\d+(\.\d+)?\s*(GB|G)\b/i.test(norm(answer)),
    solve: () => "123.4 GB",
  },

  /* Harder: things that need reading, comparing and several steps. The core tasks
     above are the floor (a small model should pass those); these are where the
     interesting failures are. */
  {
    id: "csv_sum",
    title: "read a CSV and compute a total",
    prompt: "子文件夹 `csv_sum/` 里有一个 items.csv。把 amount 那一列加起来，把总数写进同目录的 answer.txt（只写数字）。",
    setup: (dir) => seed(dir, "items.csv", "name,amount\nA,10\nB,20\nC,30\n"),
    check: (dir) => /\b60\b/.test(norm(read(dir, "answer.txt"))),
    solve: (dir) => seed(dir, "answer.txt", "60\n"),
  },
  {
    id: "find_and_fix",
    title: "find the odd file, fix only that one",
    prompt:
      "子文件夹 `find_and_fix/cfg/` 里有三个 .ini 文件。其中一个的 mode 是 dev，其余是 prod。" +
      "找出 mode=dev 的那个文件，把它的 mode 改成 prod（其他文件不要动）。",
    setup: (dir) => {
      seed(dir, "cfg/app.ini", "name=app\nmode=prod\n");
      seed(dir, "cfg/db.ini", "name=db\nmode=dev\n");
      seed(dir, "cfg/log.ini", "name=log\nmode=prod\n");
    },
    check: (dir) => {
      const names = ["app.ini", "db.ini", "log.ini"];
      return names.every((name) => lines(read(dir, `cfg/${name}`)).includes("mode=prod"));
    },
    solve: (dir) => seed(dir, "cfg/db.ini", "name=db\nmode=prod\n"),
  },
  {
    id: "rename_batch",
    title: "rename four files by a pattern",
    prompt:
      "子文件夹 `rename_batch/` 里有 part1.txt 到 part4.txt。" +
      "请把它们分别改名为 chapter-1.md、chapter-2.md、chapter-3.md、chapter-4.md，内容保持不变。",
    setup: (dir) => {
      for (let index = 1; index <= 4; index += 1) seed(dir, `part${index}.txt`, `content ${index}\n`);
    },
    check: (dir) => {
      for (let index = 1; index <= 4; index += 1) {
        if (!exists(dir, `chapter-${index}.md`)) return false;
        if (norm(read(dir, `chapter-${index}.md`)).trim() !== `content ${index}`) return false;
        if (exists(dir, `part${index}.txt`)) return false;
      }
      return true;
    },
    solve: (dir) => {
      for (let index = 1; index <= 4; index += 1) {
        seed(dir, `chapter-${index}.md`, `content ${index}\n`);
        fs.rmSync(path.join(dir, `part${index}.txt`), { force: true });
      }
    },
  },
  {
    id: "move_into_tree",
    title: "move three files into a new folder tree",
    prompt:
      "子文件夹 `move_into_tree/` 里有 a.txt、b.txt、c.txt。" +
      "请在**这个子文件夹里面**新建目录 docs/2026（即 move_into_tree/docs/2026），" +
      "把这三个文件**移动**进去（文件名不变），子文件夹根下不要再留着它们。",
    setup: (dir) => {
      for (const name of ["a.txt", "b.txt", "c.txt"]) seed(dir, name, `${name} content\n`);
    },
    check: (dir) =>
      ["a.txt", "b.txt", "c.txt"].every((name) => exists(dir, `docs/2026/${name}`) && !exists(dir, name)),
    solve: (dir) => {
      for (const name of ["a.txt", "b.txt", "c.txt"]) {
        seed(dir, `docs/2026/${name}`, `${name} content\n`);
        fs.rmSync(path.join(dir, name), { force: true });
      }
    },
  },
  {
    id: "common_line",
    title: "find the line two files share",
    prompt:
      "子文件夹 `common_line/` 里有 m1.txt 和 m2.txt。找出两个文件里完全相同的那一行，" +
      "把这一行写进同目录的 shared.txt（只写这一行）。",
    setup: (dir) => {
      seed(dir, "m1.txt", "alpha\nshared line\nbeta\n");
      seed(dir, "m2.txt", "gamma\nshared line\ndelta\n");
    },
    check: (dir) => norm(read(dir, "shared.txt")).trim() === "shared line",
    solve: (dir) => seed(dir, "shared.txt", "shared line\n"),
  },
  {
    id: "utf16_edit",
    title: "edit a UTF-16 file without breaking its encoding",
    prompt:
      "子文件夹 `utf16_edit/` 里的 utf16.txt 是 UTF-16（带 BOM）编码。" +
      "请把文件里的 name=旧名字 改成 name=新名字，并保持原来的 UTF-16 编码，不要变成 UTF-8。",
    setup: (dir) => {
      const body = Buffer.from("\uFEFFname=旧名字\n", "utf16le");
      fs.writeFileSync(path.join(dir, "utf16.txt"), body);
    },
    check: (dir) => {
      const bytes = fs.readFileSync(path.join(dir, "utf16.txt"));
      if (bytes[0] !== 0xff || bytes[1] !== 0xfe) return false;
      const text = bytes.toString("utf16le").replace(/^\uFEFF/, "");
      return text.includes("name=新名字") && !text.includes("旧名字");
    },
    solve: (dir) => {
      fs.writeFileSync(path.join(dir, "utf16.txt"), Buffer.from("\uFEFFname=新名字\n", "utf16le"));
    },
  },
];

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const options = {
    model: "",
    baseUrl: "",
    mode: "guided",
    timeoutMs: 150_000,
    only: null,
    limit: 0,
    out: "",
    selfCheck: false,
    keep: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--model") options.model = next() ?? "";
    else if (arg.startsWith("--model=")) options.model = arg.slice(8);
    else if (arg === "--base-url") options.baseUrl = next() ?? "";
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice(11);
    else if (arg === "--mode") options.mode = next() ?? "guided";
    else if (arg.startsWith("--mode=")) options.mode = arg.slice(7);
    else if (arg === "--timeout") options.timeoutMs = Number(next()) || options.timeoutMs;
    else if (arg.startsWith("--timeout=")) options.timeoutMs = Number(arg.slice(10)) || options.timeoutMs;
    else if (arg === "--only") options.only = String(next() ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--only=")) options.only = arg.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--limit") options.limit = Number(next()) || 0;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice(8)) || 0;
    else if (arg === "--out") options.out = next() ?? "";
    else if (arg.startsWith("--out=")) options.out = arg.slice(6);
    else if (arg === "--self-check") options.selfCheck = true;
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg} (try --help)`);
      process.exit(2);
    }
  }
  return options;
}

function printHelp() {
  console.log(`npm run eval -- [options]

  --model <id>       model to ask (default: settings.json / AGENT_MODEL)
  --base-url <url>   endpoint (default: settings.json / AGENT_BASE_URL)
  --mode <mode>      guided (default) or normal
  --timeout <ms>     per-task limit, default 150000
  --only <ids>       comma-separated task ids
  --limit <n>        run only the first n tasks
  --out <file>       write the JSON result here (default data/eval/<stamp>.json)
  --self-check       no model: prove every task's check rejects an empty folder
                     and accepts a correct one (this is what test:eval runs)
  --keep             keep the temp workdir and print its path
  --verbose          print each failing answer and check error
`);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** The quant a local model is loaded at (LM Studio's own API knows; OpenAI's does not). */
async function quantizationOf(baseUrl, model) {
  try {
    const origin = new URL(baseUrl).origin;
    const response = await fetch(`${origin}/api/v0/models`);
    if (!response.ok) return null;
    const body = await response.json();
    return (body.data ?? []).find((entry) => entry.id === model)?.quantization ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Self-check: every check must fail on an untouched folder and pass on a good one */
/* -------------------------------------------------------------------------- */

function selfCheck(only) {
  const chosen = only ? TASKS.filter((task) => only.includes(task.id)) : TASKS;
  if (chosen.length === 0) {
    console.error(`no task matched ${JSON.stringify(only)}`);
    return false;
  }
  let passed = 0;
  const problems = [];
  for (const task of chosen) {
    const blank = fs.mkdtempSync(path.join(os.tmpdir(), `eval-blank-${task.id}-`));
    const good = fs.mkdtempSync(path.join(os.tmpdir(), `eval-good-${task.id}-`));
    try {
      task.setup?.(blank);
      task.setup?.(good);
      const blankResult = task.check(blank, "");
      const solvedAnswer = task.solve ? task.solve(good) : "";
      const goodResult = task.check(good, solvedAnswer ?? "");
      if (blankResult !== false || goodResult !== true) {
        problems.push(`${task.id}: empty=${blankResult} solved=${goodResult}`);
      } else {
        passed += 1;
        console.log(`  ok   ${task.id}`);
      }
    } finally {
      fs.rmSync(blank, { recursive: true, force: true });
      fs.rmSync(good, { recursive: true, force: true });
    }
  }
  console.log(`\n${passed}/${chosen.length} checks are honest (fail empty, pass solved)`);
  for (const problem of problems) console.log(`  FAIL ${problem}`);
  return problems.length === 0;
}

/* -------------------------------------------------------------------------- */
/* The run                                                                    */
/* -------------------------------------------------------------------------- */

async function run(options) {
  const selected = (options.only ? TASKS.filter((task) => options.only.includes(task.id)) : TASKS).slice(
    0,
    options.limit > 0 ? options.limit : undefined,
  );
  if (selected.length === 0) {
    console.error(`no task matched ${JSON.stringify(options.only)} (see the ids in this file)`);
    process.exit(2);
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "win-agent-eval-"));
  const workdir = path.join(scratch, "work");
  const dataDir = path.join(scratch, "data");
  fs.mkdirSync(workdir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await freePort();

  // A local settings file, so the eval never touches yours. Guided mode by default:
  // the same advice the README gives for small local models.
  const settings = {
    webPort: port,
    language: "zh",
    autoOpenBrowser: false,
    workdir,
    model: options.model || "qwen/qwen3.8-27b",
    baseUrl: options.baseUrl || "http://127.0.0.1:1234/v1",
    apiKey: "eval",
    stream: true,
    maxSteps: 0,
    temperature: 0,
    contextLimit: 0,
    autoApprove: true,
    agentMode: options.mode,
    sandbox: true,
    remember: true,
    auditLog: true,
    verbosity: "answer",
  };
  const settingsFile = path.join(scratch, "settings.json");
  fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts", "--no-open"], {
    cwd: ROOT,
    env: {
      ...process.env,
      AGENT_SETTINGS_FILE: settingsFile,
      AGENT_DATA_DIR: dataDir,
      AGENT_AUTO_OPEN_BROWSER: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (chunk) => (serverLog += chunk));
  child.stderr.on("data", (chunk) => (serverLog += chunk));

  const base = `http://127.0.0.1:${port}`;
  const call = async (pathname, method = "GET", body) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    try {
      return { status: response.status, data: text ? JSON.parse(text) : {} };
    } catch {
      return { status: response.status, data: { raw: text } };
    }
  };

  const stop = () => {
    try {
      child.kill();
    } catch {
      // already gone
    }
    if (process.platform === "win32" && child.pid) {
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        // no taskkill
      }
    }
  };

  const ready = await waitFor(
    async () => {
      try {
        const state = await call("/api/state");
        return state.status === 200 ? state : null;
      } catch {
        return null;
      }
    },
    { timeoutMs: 60_000 },
  );

  if (!ready) {
    stop();
    console.error("the server did not start:\n" + serverLog.slice(-2000));
    process.exit(1);
  }

  const info = await call("/api/state");
  const model = info.data.settings?.model ?? settings.model;
  const endpoint = info.data.settings?.baseUrl ?? settings.baseUrl;
  const quant = await quantizationOf(endpoint, model);
  console.log(`win-agent eval - ${model}${quant ? ` (${quant})` : ""} @ ${endpoint} (${options.mode}, ${selected.length} tasks)`);
  console.log(`workdir: ${workdir}`);
  console.log("");

  const results = [];
  for (const task of selected) {
    const dir = path.join(workdir, task.id);
    fs.mkdirSync(dir, { recursive: true });
    task.setup?.(dir);

    await call("/api/reset", "POST", {});
    // The reset is synchronous, but give the previous turn's status a moment to settle.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const started = Date.now();
    const asked = await call("/api/chat", "POST", {
      message: `${task.prompt}\n\n所有文件都在工作目录的 ${task.id}\\ 子文件夹里，请用相对路径操作。`,
    });
    if (asked.status !== 202) {
      results.push({ id: task.id, status: "ERROR", seconds: 0, tokens: 0, calls: 0, detail: JSON.stringify(asked.data) });
      console.log(`ERR  ${task.id.padEnd(16)} ${JSON.stringify(asked.data)}`);
      continue;
    }

    let timedOut = false;
    const deadline = Date.now() + options.timeoutMs;
    // Wait until the turn really starts, so a fast poll cannot see "not running"
    // from before the request and call it done.
    await waitFor(
      async () => {
        const now = await call("/api/state");
        return now.data.running === true;
      },
      { timeoutMs: 15_000 },
    );
    for (;;) {
      const now = await call("/api/state");
      if (!now.data.running) break;
      if (Date.now() > deadline) {
        timedOut = true;
        await call("/api/abort", "POST", {});
        // Give the abort a moment, then stop waiting regardless.
        await waitFor(
          async () => {
            const after = await call("/api/state");
            return after.data.running === false;
          },
          { timeoutMs: 10_000 },
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const seconds = (Date.now() - started) / 1000;

    const finalState = (await call("/api/state")).data;
    const history = finalState.history ?? [];
    const answer = [...history].reverse().find((entry) => entry.role === "assistant" && entry.content)?.content ?? "";
    const calls = history.reduce((sum, entry) => sum + (entry.tool_calls?.length ?? 0), 0);
    const tokens = finalState.usage?.conversation?.totalTokens ?? 0;

    if (timedOut) {
      results.push({ id: task.id, status: "TIMEOUT", seconds, tokens, calls, detail: `> ${options.timeoutMs}ms` });
      console.log(`TIME ${task.id.padEnd(16)} ${seconds.toFixed(1)}s ${String(tokens).padStart(6)} tok ${String(calls).padStart(2)} calls`);
      continue;
    }

    let ok = false;
    let detail = "";
    try {
      ok = task.check(dir, answer) === true;
    } catch (error) {
      detail = String(error?.message ?? error);
    }

    results.push({ id: task.id, status: ok ? "PASS" : "FAIL", seconds, tokens, calls, detail, answer: answer.slice(0, 400) });
    const mark = ok ? "PASS" : "FAIL";
    console.log(`${mark} ${task.id.padEnd(16)} ${seconds.toFixed(1)}s ${String(tokens).padStart(6)} tok ${String(calls).padStart(2)} calls`);
    if (!ok && options.verbose) {
      console.log(`     answer: ${answer.replace(/\s+/g, " ").slice(0, 200)}`);
      if (detail) console.log(`     check: ${detail}`);
    }
  }

  // A summary that can be pasted into a README.
  const done = results.filter((item) => item.status !== "ERROR");
  const passed = results.filter((item) => item.status === "PASS").length;
  const totalSeconds = done.reduce((sum, item) => sum + item.seconds, 0);
  const totalTokens = done.reduce((sum, item) => sum + item.tokens, 0);
  console.log("");
  console.log(
    `result: ${passed}/${results.length} passed` +
      (done.length > 0 ? ` in ${(totalSeconds / 60).toFixed(1)} min (${totalTokens.toLocaleString()} tok)` : ""),
  );
  console.log("");
  console.log("| task | result | seconds | tokens | tool calls |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const item of results) {
    console.log(`| \`${item.id}\` | ${item.status} | ${item.seconds.toFixed(1)} | ${item.tokens} | ${item.calls} |`);
  }

  const outFile = options.out ? path.resolve(options.out) : path.join(ROOT, "data", "eval", `${stamp()}.json`);
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(
      outFile,
      `${JSON.stringify({ model, quant, endpoint, mode: options.mode, startedAt: new Date().toISOString(), results }, null, 2)}\n`,
      "utf8",
    );
    console.log(`\nsaved: ${outFile}`);
  } catch (error) {
    console.error(`could not save the result: ${error.message}`);
  }

  stop();
  if (options.keep) console.log(`workdir kept: ${workdir}`);
  else {
    try {
      fs.rmSync(scratch, { recursive: true, force: true });
    } catch {
      // the OS will clean temp eventually
    }
  }
  return results;
}

const options = parseArgs(process.argv.slice(2));
if (options.selfCheck) {
  const ok = selfCheck(options.only);
  process.exit(ok ? 0 : 1);
} else {
  run(options).then((results) => {
    process.exit(results.some((item) => item.status === "ERROR") ? 1 : 0);
  });
}
