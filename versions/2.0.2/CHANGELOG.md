# Changelog

Notable changes to **win-agent**. Versions use [semantic versioning](https://semver.org/):
a new minor version means a real jump in capability, not a handful of fixes.

Tooling: `npm run version:show` prints the version, `npm run version:list` lists the
backups, `npm run version:diff` shows what changed since the newest one,
`npm run version:set 1.2.0` bumps the version and opens a new section here, and
`npm run release` builds and copies the whole agent into `versions/<version>/` — one
version, one folder — and tags the commit as `v<version>`. `--set` refuses to bump a
version that has no backup yet, and `version:show` reports how far the working tree has
drifted from the newest backup.

## [Unreleased]

## [2.0.2] — 2026-10-22

Rollback becomes something you can see and pick, instead of a stack you have to
reason about.

### Added

- **The files a turn changed, under the answer.** In detail mode (`verbosity: full`)
  every answer is followed by a card listing what that turn touched — one row per
  file, with the tool and the action (`files write`, `files edit`, `files delete`).
  The turn's changes are grouped by a turn id stamped on each audit entry, so the
  card is built from the change log and never from a guess. Several changes to the
  same file in one turn show once, pointing at the last change (the one a rollback
  should start from).
- **Right-click a row: two verbs.**
  - **Undo this change** — back to how the file was *before* change `#N` (the old
    undo stack, now addressable per file).
  - **Restore this version** — make the file exactly what change `#N` produced,
    even if later turns overwrote it. Every change that leaves one file behind now
    saves a copy of the result in `data/versions/` (kept for `undoRetentionDays`),
    and the restore is itself a recorded, undoable change: a wrong click costs one
    more click.
  A row whose change deleted the file (or touched several) has no single "version",
  so that item is disabled instead of guessing.
- **`GET /api/turns`** — the last 30 turns of the conversation with their files and
  live `undoable` / `restorable` / `atVersion` flags.
- **`POST /api/versions/restore`** with `{ seq }` — the "Restore this version" item
  as an API call; 400 with the reason when there is no saved copy.
- **SSE `turn`** — sent when a turn ends, so the card appears without a reload.

### Changed

- **Turn cards survive a reload.** They are saved with the conversation (`turns` in
  `history.json`, 30 turns) together with the history position they belong to, so
  reopening the conversation puts them back under the right answer.
- A row whose file already *is* that version says **file is at this version now**
  (green) instead of looking like it was undone.

### Fixed

- `history.json` lost `turns` on load (`parseRecord` rebuilt the record from a
  whitelist) — the cards disappeared after a restart even though they were saved.

### Tests

- `test:audit` 90 checks: the turn grouping, the saved version, restoring it over a
  newer edit, and undoing that restore.
- `test:api` 181 checks: a real turn with a mock that calls `files write`, then the
  card's two verbs through the API (undo → file gone, restore → file back).
- `test:docs` knows the two new routes; `test:i18n` the new strings.
- Demoed live in `D:\try` with `qwen/qwen3.8-27b`: create a file → card appears →
  right-click → undo (file gone) → right-click → restore (file back, marked
  "当前就是这个版本"); second turn deletes a file → its row offers undo but not
  "restore this version".


## [2.0.1] — 2026-10-21

A bug the 2.0 demo found, fixed before it could eat anyone's undo stack.

### Fixed

- **Two processes no longer share a backup name.** The copies kept in `data/undo/`
  were numbered with a counter that starts at zero in every process — the web UI and
  an `--mcp-server` run (or a server restarted between two changes) would both write
  `0001-notes.txt`, so the second snapshot overwrote the first. The older entry then
  pointed at the newer content: rolling it back restored the wrong bytes, or (when
  the copy had been dropped) the change silently stopped being undoable. Copy names
  are now made unique against what is already in the folder, so every entry keeps its
  own snapshot no matter which process took it.

  Found by rolling back a real three-step sequence in `D:\try` (write → edit → delete,
  driven through the MCP server while the web UI watched): undoing the delete and then
  the edit left the write entry greyed out. With the fix the same sequence rolls back
  delete → edit → write, each file byte-identical to its earlier self.

- **`test:audit` grew to 83 checks** with that exact case: two `AuditLog` instances
  (what two processes look like) backing up the same file, both copies holding their
  own moment, and undoing the newer one not touching the older one's copy.



## [2.0.0] — 2026-10-21

win-agent is no longer only a client: **it can be the toolset another agent uses**,
and the whole capability surface can be read from one panel. 1.8 made it carry more
(skills, no artificial step limit), 1.9 made it keep working when you leave (a queue
that survives a restart), and 2.0 makes it **composable** — the same tools, in the
other direction.

### Added

- **MCP server mode.** `win-agent --mcp-server` (or `npm run dev -- --mcp-server`)
  speaks MCP over stdio: `initialize`, `tools/list`, `tools/call`, `ping`. Another
  agent — Claude Desktop, an IDE, any MCP client — starts the process and gets the
  same Windows tools the chat model gets, with the same JSON Schema:

  ```json
  {
    "mcpServers": {
      "windows": {
        "command": "node",
        "args": ["D:/new/dist/index.js", "--mcp-server"],
        "env": { "AGENT_WORKDIR": "D:/work" }
      }
    }
  }
  ```

  Two rules make it safe: **stdout carries protocol frames only** (everything for a
  human goes to stderr, and a test fails if a single line is not JSON), and **there
  is nobody to press Approve**, so destructive actions are refused with
  `Cancelled by user.` and the reason on stderr unless **Settings → MCP → MCP server
  mode: auto-approve** (or `AGENT_MCP_SERVE_AUTO_APPROVE=true`) is on. Even then the
  change lands in `data/audit.jsonl`, so **Undo** still works.
- **Capabilities panel** (**Settings → Capabilities**, `GET /api/capabilities`):
  every tool the model is offered right now with its description, the tools held
  back **and why** (guided mode withholds the raw shell), the skills that can be
  loaded, and how many MCP servers are up. One glance answers "what can this agent
  actually do?", and it changes with the mode and the tool switches.
- **`npm run test:mcp-server`** (29 checks): the handshake (the client's protocol
  version is echoed), `tools/list` schemas, a real read-only call, a relative path
  resolved against the workdir, an unknown tool as `isError` rather than a crash,
  invalid JSON and unknown methods, a destructive call refused and the file still
  there, the same call succeeding with auto-approve on, and **stdout purity**.
- [examples/mcp-server.md](examples/mcp-server.md): client config for a built copy
  and a checkout, the tool table, the approval rule, a worked example, and a
  troubleshooting table.

### Changed

- Settings table, env table, CLI list, architecture tree and the example index all
  carry the new direction; `test:api` grew to 169 checks (the capabilities report),
  and the Windows CI job runs the new suite while the portable job skips it, because
  the tools under test are Windows tools.



## [1.9.0] — 2026-10-21

One thing changes here: **a turn is no longer a lock on the whole agent**.

### Added

- **The queue.** Sending a message while a turn is running no longer answers
  "busy" — the message waits, and the next one starts by itself the moment the
  current turn ends. In the UI that is a strip above the composer (up to 20
  messages, × to drop one, **Clear** for all of them); over HTTP it is
  `POST /api/chat` answering `{ queued: true, position }`, `GET /api/queue` and
  `POST /api/queue`. Together with 1.8's "no step limit" this is the point of the
  version: hand over three jobs and leave the machine to it.
- **The queue survives a restart.** Every change is written to `data/queue.json`;
  on the next start the messages that were waiting are waiting again and the first
  one starts as the server comes up. A `data/` folder that cannot be written to is
  not an error — the queue still works, in memory.
- **A queue event on the stream** (`{ type: "queue", items }`) so the page, and
  anything else listening, sees the waiting list change: added, started, dropped,
  cleared.
- **`test:api` covers it** (162 checks): a message sent during a slow turn is
  queued rather than refused, the list carries its text, dropping one works and a
  dropped message leaves the file, an unknown id is a 404 and an unknown action a
  400, and the queue **drains by itself** — the queued job runs in the same
  conversation without another request. Verified in the browser against a real
  local model (`qwen/qwen3.8-27b`): the strip showed `1. … ×` while the first turn
  ran, then emptied on its own.

### Changed

- Sending during a turn is allowed, so the **Send** button no longer greys out
  while the agent works (Stop sits next to it). A queued message shows
  "queued — position N" as a notice.
- Docs: the [Chat](README.md#chat) section, the API table, and the `data/` tree.



## [1.8.0] — 2026-10-21

Two changes that make the agent *carry more without carrying it in the prompt*.

### Added

- **Skills** — a procedure the model loads only when a task matches it. A skill is a
  folder with a `SKILL.md` under `data/skills/`, with a small header:

  ```markdown
  ---
  name: clean-temp
  description: Find old files in %TEMP% and remove them safely
  when: The user asks to free up disk space or clean temporary files
  ---
  # Clean the temp folder
  1. ...
  ```

  The system prompt carries **one line per skill** (name, description, when) and the
  instruction to load the one that fits; the body is fetched with the new `skills` tool
  (`list` / `load` / `read`). Ten skills cost ten lines of context instead of ten
  thousand characters, and the chat log shows which procedure the model chose —
  `skills load clean-temp` is a tool call like any other. Verified end to end on a
  local `qwen/qwen3.8-27b`: asked for a quick health check, it found the skill by its
  `when`, loaded it, and followed its steps.
- **The same folder in the web UI** — Settings → Skills lists every skill, with an
  editor (name, one line, *when*, steps) and delete. Writing `SKILL.md` by hand with any
  editor is equally valid: the folder is the record, there is no database to sync.
- **`/skills`**, `/skills show <name>`, `/skills path` in the terminal.
- **`GET /api/skills`** (`?name=` returns the body), **`POST /api/skills`**,
  **`POST /api/skills/delete`**.
- **`data/skills/README.md`** is written on first start, so the format is explained
  where the files are.
- **`npm run test:skills`** (55 checks): the header block (quotes, a BOM, CRLF,
  `when_to_use`, no header at all), the one-line index that never carries a body, a
  broken `SKILL.md` reported instead of hidden, the tool's three actions, `../` and
  absolute paths out of a skill folder refused, and delete really removing the folder.

### Changed

- **No step limit by default.** `maxSteps` is now `0` = *no limit* (1–1000 still sets
  a cap, and `/maxsteps 0` does the same). A long task may take as many rounds as it
  needs; the brakes are the work that cannot progress: a third identical call with the
  same answer is refused, and **five refused calls in a row end the turn** with
  `(stopped after 5 blocked repeats: …)` — the only limit left, and exactly the one
  that matters. The settings panel, the chat's step counter (`step 7` when there is no
  ceiling) and `/status` all say "no limit" instead of printing a misleading zero.
- Docs: a [Skills](README.md#skills) section, [examples/skills.md](examples/skills.md)
  with three complete skills (temp cleanup, a service restart checklist, a weekly
  report), the tool/command/API tables, and the data-folder layout.
- `test:agent` grew to 27 checks (a run with no step limit, and the blocked-repeat
  fuse), `test:api` to 150 (the three skill routes), and the docs suite now accepts the
  `/skill` alias.


## [1.7.0] — 2026-10-21

A small model does not usually fail by being unable to do the task. It fails by
repeating itself, by drowning in one huge tool result, and by reading an error as
"try again". This version handles all three, and each one is visible in the chat log
instead of being a mystery.

### Added

- **The loop guard** (`loopGuard`, on by default): when the model asks for *the same
  call* and gets *the same answer* twice, the third one is answered instead of run —
  `Blocked: this exact call (files {"action":"read","path":"…"}) has already returned
  the same result twice, so running it again cannot change anything. Change the
  argument, use another tool, or tell the user what you have found.` Only a genuine
  dead end is caught: a poll whose answer keeps changing, a call with a different
  argument (compared by canonical JSON, so key order does not matter), or the same call
  after something else in between are all unaffected. Switchable in Settings, via
  `/set loopGuard off`, or `AGENT_LOOP_GUARD=false`.
- **The step limit says what it is.** Hitting `maxSteps` used to end the turn with
  `(stopped after 12 steps without finishing the task)`. It now names the limit, the
  number, and the way on — send "continue", raise the setting, or split the task — in
  the interface language.
- **One tool result cannot eat the window.** A result is trimmed to its head and tail
  (`... (N characters trimmed; use a narrower call if you need the middle) ...`) before
  it is stored, so the conversation file and the next request both stay bounded.
- **PowerShell output is capped while it is read** (~1 MB: 600 KB head + 400 KB tail,
  with a note saying how much was dropped). Accumulating a `Get-Content` of a 2 GB log
  into one JS string used to be a way to take the whole agent process down.
- **Error classification, in the interface language.** After a failed command the
  model now gets a sentence it can act on: syntax error, unknown cmdlet, locked file,
  parameter binding, path, DNS, disk full, timeout — alongside the existing permission
  (which says whether win-agent is elevated) and service hints. The PowerShell text
  above the hint stays English; the hint follows `language`, and is switchable in the
  same way every other behaviour is.
- **`npm run test:agent`** (22 checks): the agent loop against a mock endpoint and a
  fake tool — the guard blocking (and not blocking), the step limit in both languages,
  a 200 000-character result being trimmed, and the signature canonicalisation. It runs
  anywhere, with no model and no Windows.

### Changed

- `test:windows` grew to 66 checks: one per error class, the hint following the
  interface language, and a real 1.2-million-character stream being capped.
- Docs: a new [Staying on the rails](README.md#staying-on-the-rails) section with the
  switches, `examples/stability.md` (a blocked call, a run that hits the limit, a
  trimmed result, the prefix glossary: `Error:` / `Refused:` / `Blocked:` /
  `Cancelled by user.` / `DRY RUN:`), and the settings, environment and test tables.


## [1.6.0] — 2026-10-19

Two halves of the same promise: the sandbox stops taking tools away and starts
*reading* them, and the changes that do get through can be rolled back long after
the server that made them is gone.

### Added

- **The command fence: a PowerShell script is read before it runs** (`scanScript()` in
  `src/sandbox.ts`). With the sandbox on, `powershell` is offered again instead of being
  withheld, and the script is scanned before the approval prompt: a literal path out of
  the working directory (`C:\Windows\…`, `\\server\share\…`, with or without quotes), a
  `..`, a `~\…`, a `$env:NAME` that resolves outside it, a path built from a variable
  that is not set, `iwr`/`irm`/`DownloadString` piped into `iex`/`Invoke-Expression`, and
  the commands that destroy something no audit entry can put back (`Format-Volume`,
  `Clear-Disk`, `Initialize-Disk`, `Remove-Partition`, `diskpart`, `bcdedit`) all come
  back as `Refused: … so the script was not run`, before anything executes. Everything
  else reaches the normal approval prompt, so a legitimate `Get-ChildItem` is no longer
  impossible. The README says plainly what this is: **a guard, not a jail** — a path the
  script only learns while it runs cannot be read out of text, and closing that needs an
  OS-level sandbox.
- **Every change can be rolled back from the list, one row at a time.** `POST /api/undo`
  takes `{ seq }` as well as `{ count }`, and Settings → *Change log and undo* puts a
  **Roll back** button on every row that can still be reversed. `/undo <n>` and **Undo
  the last change** are unchanged.
- **The copies that make an undo possible are kept for `undoRetentionDays`** (default
  `7`, 1–365, `AGENT_UNDO_RETENTION_DAYS`). They are swept by age — at start and before a
  new copy is taken — instead of being deleted on every start. A setting, a number field
  in Settings, and reported as `retentionDays` by `GET /api/audit`.

### Changed

- **The audit log *is* the undo stack.** What can be undone is rebuilt from
  `data/audit.jsonl` on every request instead of living in memory, so a restart no
  longer empties it and a change from last week is still reversible; `seq` continues
  across runs, an undo is itself a log line (`tool: "undo"`, `ref: <the change>`), and
  the same change cannot be reversed twice. When a copy has expired (or was deleted by
  hand) its entry simply stops being undoable — a `restore` with nothing to restore from
  would delete the current file, so it is skipped instead of half-run.
- **The sandbox no longer withholds `powershell` or `custom`.** The shell is read
  instead (above); `custom` is code you wrote and approved yourself and is documented as
  outside the fence, like an MCP server. `guided` mode still withholds the shell, for its
  own reason.
- **`npm run test:sandbox` is now a command-fence suite** (52 checks): backslash paths,
  quoted paths with spaces, `..`/`~`/`$env:` escapes, an ambient `$env:` that resolves
  inside (allowed), the destructive-command and download-and-run blocks, and a script
  that stays inside the folder actually running. `test:audit` grew to 78 checks: a second
  `AuditLog` over the same folder stands in for a restart and proves the stack comes back,
  and a copy aged past the retention window is swept away *and* its entry stops offering a
  rollback.
- Docs: the README's [Sandbox](README.md#sandbox) and
  [Audit log and undo](README.md#audit-log-and-undo) sections, the settings / environment
  / HTTP API tables, `examples/sandbox.md` (a refused script end to end, and the honest
  limits), and `examples/api.md` (the `{ seq }` rollback).

## [1.5.1] — 2026-10-19

The agent is fenced into one folder. A file path that points outside the working
directory is refused *before* anything is touched, and the two tools that could walk
around the fence — a raw script and a custom command — are not offered while it is on.
It is on by default; one switch turns it off.

### Added

- **Sandbox — every file path stays inside the working directory** (`sandbox`, on by
  default). The switch exists in the chat sidebar *and* in Settings and applies at
  once, `/sandbox on|off` does it from the terminal, and `"sandbox": false` /
  `AGENT_SANDBOX=false` does it before the first start. `files` (list, tree, read,
  write, append, edit, copy, move, delete, mkdir, search, grep, hash, zip, unzip) and
  `web` (download) resolve every path against the working directory and refuse the
  rest with `Refused: … is outside the sandbox (…), so nothing was touched` plus the
  three ways out: work inside the folder, change the working directory, or switch the
  sandbox off.
- **Junctions and symlinks are followed first** (`realpath`), so a link that sits
  inside the folder but points outside is not a way out — the check happens on the
  real location, not on the string.
- **The scripting tools are withheld while the sandbox is on.** `powershell` and
  `custom` run arbitrary code, which no path check can confine; calling one answers
  with the reason and points at the structured tools instead of "unknown tool". In
  `guided` mode the shell keeps its own, earlier reason, because that is the accurate
  one there.
- **`npm run test:sandbox`** (38 checks): the fence itself, `..` / absolute / sibling
  paths, a junction pointing out, a refused write that leaves no file, the withheld
  tools and their messages, and that switching the sandbox off lets the same calls
  through.
- **An `.AGREEMENT` file**, in the repository root and inside every
  `versions/<version>/` folder. It is a standalone copy of the terms that already live
  in `LICENSE` (Apache 2.0), `NOTICE` and the ecosystem notice at the top of the
  README: anything built on win-agent has to credit the original author
  (`zhoubingxuan`). `SNAPSHOT_ITEMS` in `scripts/version.mjs` carries it into new
  snapshots, and `npm run test:docs` checks that the root copy and all the version
  folders exist and agree.

### Changed

- A path outside the sandbox comes back as `Refused: …` rather than `Error: …`, so the
  model treats it as "change the argument", not "retry the same call".
- `examples/sandbox.md` walks through a refused path end to end, the four ways to
  switch the fence, and how to work outside the folder on purpose.

## [1.5.0] — 2026-10-19

How much of the agent's *process* the chat shows is now a slider with three stops, and
the model's reasoning becomes something you can read instead of a character counter.
Nothing about the work changed — same tools, same arguments, same approvals.

### Added

- **Output detail: `answer` / `thinking` / `full`** (`verbosity`, three-stop slider in the
  chat toolbar *and* in Settings, `/verbosity` in the terminal, `AGENT_VERBOSITY`).
  `answer` — the new default — is your message and the model's answer, so a 7B model's
  dozen tool calls no longer bury the two lines you actually asked for. `thinking` adds
  the model's reasoning, live and foldable; `full` is the machine room: reasoning, every
  tool call with its arguments and result, `step n/m` markers and per-call token usage —
  the 1.4.x view, plus the reasoning. Errors and approval prompts are never hidden.
  See [Output detail](README.md#output-detail) and
  [examples/verbosity.md](examples/verbosity.md).
- **The reasoning is forwarded, not just counted.** `onReasoning` text was thrown away
  after being counted (`thinking… (94 chars so far)`); the server now streams it to the
  UI in small batches. It is kept with the conversation — per assistant message, capped
  at 20 000 characters — so moving the slider up later replays what past turns were
  thinking. Non-streaming endpoints are replayed the same way, so `stream: false` shows
  it too.
- **A `NOTICE` file**, and a **License** section at the end of the README. Apache 2.0
  §4(d) makes the notice part of every redistribution: it is shipped in each
  `versions/<version>/` folder, and a fork or plugin has to carry it too. The requirement
  itself is short — credit the original author (`zhoubingxuan`) in your README,
  documentation or user interface.

### Changed

- **The reasoning is stripped from every request.** `ChatMessage.reasoning` is ours: the
  request body is built from a field whitelist (`role`, `content`, `tool_calls`,
  `tool_call_id`, `name`), so an endpoint that rejects unknown fields never sees it, and a
  model never reads its own thinking back.
- **The terminal follows the same setting.** On `answer` the CLI prints the answers (plus
  approvals and errors); on `full` it prints its `step` / `-> tool` / `<- result` lines.
  It has nowhere to fold a reasoning block, so the reasoning stays a chat-view thing. The
  startup banner now says which level is in effect.

### Fixed

- The duplicated empty `[1.4.2]` heading in this file is gone.

## [1.4.2] — 2026-10-18

Test-infrastructure patch. **Nothing in `src/` changed**: the agent, the tools, the prompt
and the web UI are exactly the 1.4.1 that runs. This release is about the suites telling
the truth — and about a red CI run saying *what* broke.

### Fixed

- **The suites no longer pin ports.** `test:providers` bound 8798/8799, `test:models`
  bound 8790–8794 and `test:mcp` bound 8795/8796, assuming nothing else on the machine
  held them. A port in use killed the suite at startup with an `EADDRINUSE` stack trace
  *before its first check* — a red run that says nothing at all about the code (which is
  exactly the shape of the flaky `main` failure that led here: the CI job died six
  seconds into the suite). Every suite now asks the OS for free ports the way `test:api`
  always has, and the "unreachable endpoint" checks keep a free port closed instead of
  naming one they hope is empty.
- **A temp folder that cannot be deleted no longer fails a suite.** `test:windows` and
  `test:isolation` removed their scratch folder in a bare `finally`; on Windows a handle
  is sometimes held for a moment (an antivirus scan, a PowerShell that has just exited)
  and that throw turned a green run red. Both now swallow the removal error, as
  `test:api` and `test:audit` already did.

### Changed

- **`npm run test:all` is now [`scripts/test-all.mjs`](scripts/test-all.mjs)**. It runs
  the eleven suites in order, streams their output and stops at the first failure, like
  the `&&` chain it replaces — and it echoes every failing check as a GitHub
  **annotation** (`::error::`). A job log needs an authenticated request to read;
  annotations are public, so the next red CI run names the check that broke instead of
  only "Process completed with exit code 1".

## [1.4.1] — 2026-10-18

A patch for the two things 1.4.0 got wrong in practice, both found by driving a real
7B model through the browser UI: a turn could end with nothing on screen, and the
conversation could stop following its own output. No tool, setting or prompt changed.

### Fixed

- **A model that answers with nothing no longer ends the turn in silence.** A small
  reasoning model can spend its whole completion in the thinking channel — the usage
  line reads `↓94 (88 reasoning)` and not one character of visible text arrives — and
  the agent loop accepted that as the final answer: no bubble, no error, nothing to
  read, and the user repeated the question because it looked like the model had done
  nothing. The agent now asks once more, with a nudge appended to that one request
  ("Your last reply was empty: no text for the user and no tool call. Reply to the user
  now, in plain text."), and if the reply is still empty it says so in the answer
  itself: `(no answer: the model returned an empty reply after 88 characters of
  thinking. Send it again, or pick another model.)` When the reply was nothing but
  chat-template artefacts, the notice quotes what the model actually produced instead.
  The notice is written into the conversation record, so a reload shows the same thing,
  and it is translated for the Chinese UI.
- **The chat pane follows its own output again.** The scroll fix in 1.4.0 decided
  whether to follow by measuring the distance to the bottom *after* appending, so a
  single tall tool result (a `system disk` listing, a file tree, a long error) pushed
  the view past the 120 px guard — and every token after it, the answer included, went
  off screen while the reader sat still. The decision is now made by real scroll events,
  so it survives an append of any size: the tail of the log is followed while you are
  at the bottom, and reading history is left alone. A reload jumps to the newest
  message (the layout used to leave you wherever it landed — often near the top of a
  long conversation), and sending a message always brings the newest output back into
  view.

### Changed

- `scripts/test-api.mjs` grew to 120 checks: its mock model can now answer with nothing
  at all, and two checks pin both halves of the fix — the retry really happens (the
  second request carries the nudge) and the user is told, in the stored history, what
  happened.
- `npm run release` now includes `LICENSE` in the version folders, so a restored copy
  is complete.

## [1.4.0] — 2026-10-18

The release that makes a small model **safe to leave alone**: every change it makes is
now written down, everything that can be taken back is one `/undo` away, and guided
mode no longer hands a 7B model a shell to improvise in. Three things landed together,
because they answer the same worry.

### Added

- **Audit log** (`src/audit.ts`, `data/audit.jsonl`) — one JSON object per change,
  append-only, with the tool, the action, a human summary, the paths it touched and the
  steps that would reverse it. `Get-Content data\audit.jsonl -Tail 20` is the raw view;
  the file is trimmed to its newest 1000 records when it passes 4 MB, so a long-running
  install cannot grow it without end.
- **`/undo`** — reverses the newest change, `/undo <n>` the newest `n`, `/undo list`
  shows what could be reversed without touching anything. A change is only offered as
  undoable when it can be restored *faithfully*:
  - `files write`/`append`/`edit`/`delete`/`move`/`mkdir`/`copy` — the old file (or the
    whole folder tree) is copied into `data/undo/` first, so it comes back byte for
    byte, BOM and encoding included; a folder that gained content afterwards is never
    thrown away (the `rmdir` step fails, and `/undo` says which step did), and a `move`
    that replaced an existing file restores *both* files (the steps run in reverse, so
    the moved file goes home first and what the move destroyed is put back after).
  - `registry set`/`delete` — the previous value is read back **with its registry kind**
    (`DoNotExpandEnvironmentNames`, so a `REG_EXPAND_SZ` value is not written back with
    the environment baked in) and restored with `-PropertyType`.
  - `system env_set` — the previous value, or its absence.
  - `scheduled_tasks create` of a new task, and `scheduled_tasks delete` (the task
    definition is exported before it is removed).
  - Everything else is recorded and marked **not undoable**: overwriting an existing
    folder, a previous state that could not be read, anything over 64 MB, and the
    actions with no inverse (services, processes, `shutdown`, `ui`, the clipboard,
    firewall, `zip`).
- **The raw-script tools are recorded too** — `powershell` with the first 200
  characters of the script, your own `custom` commands with the command and its
  argument, and MCP tool calls with the server, tool and arguments. None of them are
  undoable: what a script did cannot be described, only quoted, and an audit log that
  skipped them would be lying by omission.
- **A new setting, `auditLog`** (default `true`), with `AGENT_AUDIT_LOG` and a switch in
  the Settings tab: off means nothing is recorded, nothing is copied aside, and there is
  no undo history.
- **Settings → *Change log and undo*** — the log file, how many changes can be undone,
  the newest records, and one **Undo the last change** button.
- **API**: `GET /api/audit` (`?n=`), `GET /api/undo`, `POST /api/undo` (`{ count }`).
- **`npm run test:audit`** (65 checks) — makes real changes in a temp folder and then
  reverses them for real: files (write, append, edit, move, copy, delete — a folder tree
  included, and a UTF-16LE file restored byte for byte), registry values (DWord, String,
  MultiString, including a value that did not exist), an environment variable, the cases
  that must refuse to be undoable, and the guided-mode shell.
- **`examples/audit-undo.md`** — the whole feature with real output.

### Changed

- **Guided mode does not offer the `powershell` tool any more.** The tool is still
  registered — the Tools panel and `/tools` show it as `not offered`, with the reason —
  but it is taken out of the schemas sent to the endpoint and out of the catalogue in the
  system prompt, and `GUIDED_INSTRUCTIONS` gained rule 9 ("there is no shell in this
  mode: never write command lines, scripts or registry paths"). A model that calls it
  anyway gets `Error: the raw shell is switched off in guided mode. do not write commands
  or scripts. Use the structured tools instead: system (action "disk" …), files,
  services, …` rather than a shrug. This is exactly the fix for a small model that keeps
  inventing `Get-CimInstance | Select-Object` one-liners: it can no longer see a shell to
  imitate, and every action it needs exists as a tool. Your own `custom` commands and the
  Terminal tab are unaffected; `normal` mode brings the shell back.
- `/status` gained `audit` and `withheld` lines, `/tools` lists what is not offered,
  `/data` lists `audit.jsonl`, and `GET /api/state` reports `withheld`.
- `test:api` grew from 94 to 114 checks (the audit routes, the terminal commands, the
  switch, and guided/normal tool lists), `test:mode` from 74 to 85 (the withheld-tool
  logic and the new guided rule), and `test:mcp` gained the "an MCP call is recorded"
  check.

### Fixed

- **The page no longer scrolls — the conversation does.** The chat view is a grid item
  with the browser's default `min-height: auto`, so it grew to fit the whole
  conversation instead of shrinking; the document became a 1150 px tall scroller on a
  965 px window, and the composer sat below the fold. `.main` now takes `min-height: 0`
  with `overflow: hidden`, the topbar/chatbar/composer are `flex: 0 0 auto`, and
  `html`/`body`/`.app` never scroll: the log, the terminal and the settings pane are the
  scrollers. `atBottom()` became `followBottom()` — new output only pulls the view down
  when the reader is already within 120 px of the bottom, so scrolling up to read history
  is no longer interrupted by the next token.

## [1.3.1] — 2026-10-18

A patch that makes the project check itself: **continuous integration** on every push,
and three test suites that pin the things that used to be checked by hand — the HTTP
API, the two languages, and the documentation. No tool, setting or prompt changed;
this release is about not breaking the next one.

### Added

- **CI** (`.github/workflows/ci.yml`) on every push to `main`, every tag and every pull
  request: `npm ci` → `typecheck` → `build` → `test:all` on **windows-latest** with both
  Node 20.x (the documented minimum) and 22.x. A second job runs the
  platform-independent suites on ubuntu, which is where `test:windows` must skip
  cleanly rather than fail. No model, no LM Studio/Ollama, no network beyond `npm ci`:
  the model endpoints in the suites are mock servers.
- **`npm run test:api`** (94 checks) — starts the real `src/server.ts` against a temp
  data folder and a mock model, then drives the whole API exactly like the browser UI:
  every route's shape, the settings round-trip (and a refused value changing *nothing*),
  the `apiKey` never appearing in a reply, profile create/use/remove, the terminal
  (`/status`, `/mode`, an unknown command, a failing shell line), conversations,
  usage, abort/approve, port validation, drives listing — plus a complete model turn
  checked all the way into `data/history.json`.
- **`npm run test:i18n`** (25 checks) — reads both dictionaries out of `src/web/app.js`
  and compares them key by key: nothing missing in `zh`, no placeholder added or
  dropped, placeholders numbered without gaps, every `data-i18n` attribute and every
  `t("…")` call resolvable in both languages, no unused string — then the same for the
  terminal messages in `src/commands.ts`, and `/help` may only advertise commands the
  dispatcher really implements (both languages).
- **`npm run test:docs`** (21 checks) — reads the README, the CHANGELOG and `examples/`
  against the source: every route the server answers is documented and vice versa,
  every settings key in the reference table is a real setting **with the documented
  default**, every `/command` in the tables is implemented, every documented `AGENT_*`
  variable exists (and every one in the source is documented), every relative link and
  every `#anchor` resolves, every file in `examples/` is indexed, `versions/INDEX.md`
  lists every version folder, and the CHANGELOG documents the current version.
- **A complete environment-variable table** in the README. The code had supported
  sixteen `AGENT_*` variables and only five were documented; `test:docs` now fails if
  that drifts again.

### Fixed

- **`GET /api/state` could answer with a half-filled `windows` object.** The PowerShell
  probe published a preliminary result (elevation known, version and edition still
  empty) before asking for the version, and any request that arrived in that window —
  including the one the browser makes while the page is loading — got it and cached it
  in the Settings panel. The probe is now published in one piece, there is one probe at
  a time (a second caller shares the answer instead of racing it), and when the version
  genuinely cannot be read the panel says *why* (`windows.note`) instead of showing a
  blank line. Found by `test:api` on its first run; pinned in `test:windows` (57 checks
  now) with a second caller arriving in the middle of the probe.
- **The web terminal started in the wrong folder.** The terminal keeps its own working
  directory (so `cd` lasts across lines) and it was initialised from the folder the
  server happened to be launched in, not from the `workdir` setting — so the chat
  toolbar and the terminal disagreed with the setting until the first `/workdir`. It is
  now started in the configured `workdir`; after that it still only moves when you ask.
- **`test:windows` no longer leaves a file behind on Program Files**, and it skips the
  permission check where it cannot mean anything (an elevated shell, or a leftover file
  it cannot remove) instead of failing on a writable Program Files.

### Changed

- The README's test list, architecture tree and the "Windows compatibility" section now
  match the new suites; `examples/README.md` states that every example is verified by
  CI. **`test:windows` grew from 55 to 57 checks.**


## [1.3.0] — 2026-10-18

Two changes that make the agent better at its actual job: it now **supervises a small
local model instead of hoping**, and it **survives the Windows machine it runs on**
(PowerShell 5.1 *and* 7, localized errors, UTF-16 files, processes that will not die,
scheduled tasks that silently ignored their start time).

The headline is `agentMode`: a **guided** mode, on by default, that gives a 3B–14B model
an explicit operating procedure, spells out every tool's required arguments, and allows
**one tool call per step**. Flip one slider to `normal` for a cloud model.

### Added

- **Two agent modes — `guided` (default) and `normal`.** `guided` is built for local
  small models: the system prompt gets a numbered operating procedure (one tool per step,
  read the result before the next step, never invent a tool, use the documented argument
  names, retry the *same* tool once on `Error:`, never guess a path, announce destructive
  steps, answer in plain text when done) and the tool catalogue lists each tool's argument
  names with the required ones marked (`arguments: path (required), name, value, type`).
  `normal` is the previous behaviour: plain prompt, as many tool calls per step as the
  model emits. Everything else — tools, approvals, memory, context budget — is identical.
  The procedure ships in English and Chinese and follows the `language` setting.
  - **One tool call per step is enforced, not requested.** Extra `tool_calls` in the same
    message run nothing and get a tool result saying so
    (`Skipped: guided mode runs one tool call per step…`), so the model can never be told
    an action succeeded that never ran, and every decision stays anchored to a real result.
  - **One switch, three surfaces:** the *normal ↔ guided* slider in Settings → *Agent
    mode*, `/mode guided|normal` (bare `/mode` prints the current one), and the
    `agentMode` setting (`AGENT_MODE=guided|normal`). Aliases are accepted
    (`supervised`, `strict`, `高监督`, `plain`, …). `GET /api/state` reports the mode and
    returns the **verbose** catalogue while it is on, so a front end can show the model
    exactly what it was told.
- **`psEnglishErrors` (on by default) — error text is always English.** PowerShell's *UI*
  culture is pinned to `en-US` before every script, so a Chinese/German/Japanese Windows
  answers with a message a small model can act on. Date and number formatting is
  untouched (`{"d":"2026/1/2 0:00:00","n":1234.5}` still comes back locale-formatted), and
  it can be turned off in Settings → *Windows*. (A PowerShell *parse* error happens before
  the pin and stays localized, which is why the built-in tools never end a JSON script
  with `}`.)
- **Settings → *Windows* panel.** The PowerShell binary actually being driven (path,
  version, edition), whether the agent is elevated — and the switch above. `/status` prints
  `shell`, `admin` (with what will be refused when not elevated) and `psErrors` lines, and
  `GET /api/state` gained a `windows` object: `{ exe, found, version, edition, elevated,
  englishErrors }`.
- **Where a failure is, and what to do about it.** `explainPowerShellError` appends one
  actionable hint to the three common failures: permission denied (naming *your* elevation
  state and whether to restart elevated), "not recognized"/"cannot find the path" (check
  the path), and unknown service names (use the short name).
- **`npm run test:mode`** (74 checks, model-free, any platform): both system prompts in
  both languages, guidance selection, one-tool-per-step splitting, the verbose catalogue,
  lenient tool-argument repair, file encodings and CLIXML decoding.
- **`npm run test:windows`** (55 checks against the machine you are on): PowerShell
  resolution/version/edition/elevation, English error text, the permission hint, a hung
  script killed promptly, `system info`, services, ping/port-check/connections, every
  encoding Windows writes, the registry and the task-scheduler script builder.

### Fixed

- **Windows PowerShell 5.1 wrapped redirected errors in CLIXML.** A failed command arrived
  as `#< CLIXML <Objs …><S S="Error">…`, so every error looked like a broken tool. The XML
  is decoded, unescaped, and stripped of console-only filler (the source echo, the caret
  line, the localized `所在位置` location line, `CategoryInfo`), leaving the message and the
  hint.
- **Files were read as UTF-8 however they were written.** Notepad's "Unicode" and
  PowerShell 5.1's `Out-File` write UTF-16; a UTF-8 BOM is also common. `files read`
  returned NUL-laced `h\0e\0l\0l\0o`, and *editing* such a file silently converted it to
  UTF-8. New `src/util/text.ts` detects the encoding (BOM, or the NUL pattern for BOM-less
  UTF-16) and: `read` returns clean text and **refuses binary files** with a message,
  `edit`/`append`/overwrite-`write` write the file back in **its own** encoding and BOM,
  `grep` searches UTF-16 files and skips binary ones, and a UTF-16 `data/settings.json` is
  read too.
- **A timeout did not kill what the command had started.** `child.kill()` kills
  `powershell.exe`, not the `robocopy` under it. Timeouts now run `taskkill /pid <n> /T /F`
  (whole tree), `PsResult` carries `timedOut`, and the result says the command was killed.
- **`scheduled_tasks create` silently ignored `time`.** The start time was computed from
  `$t` one line *before* `$t` was assigned, so every task was created for five minutes from
  now. The script is now built by an exported, tested `buildTaskScript()` with a tolerant
  `[datetime]::TryParse`, and the reply reports the next run time Task Scheduler computed
  for the task it actually created.
- **`network port_check` printed the literal `${host}:${port}`.** PowerShell does not
  interpolate inside a single-quoted string. Rewritten around a `TcpClient` with an
  explicit timeout — correct, and fast.
- **`runPsJson` broke on scripts ending in `}`** (`… } | ConvertTo-Json` →
  `EmptyPipeElement`); `ipconfig`/`connections` now end with a variable instead.
- **`ping` used a cmdlet that changed between PowerShell versions.** It now uses .NET's
  `Ping` class (`Test-Connection` has no `-TargetName` on 5.1 and no `-ComputerName` on 7).
  `connections` falls back to `netstat -ano` without the `NetTCPIP` module, and `services`
  falls back to the `Win32_Service` CIM class when `Get-Service` has no `StartType`.
- **`powershell.exe`/`pwsh.exe` are resolved, not assumed.** The binary is looked up
  through `PATH`, `PATHEXT` and the known install folders (shared with MCP's command
  resolver via `src/util/exec.ts`); when nothing is found the error names everything that
  was tried instead of `spawn ENOENT`.
- **Small-model mistakes get a hint instead of a wall.** Tool arguments with a trailing
  comma, a single-quoted string or a comment are repaired before being rejected
  (`parseToolArguments`), and an unknown tool name is answered with *"did you mean
  `services`?"* (`editDistance`/`closestName`) instead of a list of names.
- **`system info`** now also reports the PowerShell version/edition/path, elevation, time
  zone and current time.

### Changed

- **`/status` and `/help`** gained the mode, the resolved shell, elevation and
  `psErrors`; `/set agentMode` / `/unset agentMode` work like any other setting.
- The boot banner states the resolved PowerShell (with version) and whether the agent is
  elevated, because that decides what the tools can do.
- **Docs:** `examples/modes.md` (both modes side by side, with the real prompts and
  catalogues) and `examples/windows.md` (every compatibility fix above, and how to
  reproduce it), plus new rows in the settings reference and
  `examples/settings.md`.


## [1.2.0] — 2026-10-18

Three things that make the agent reach further without making it harder to drive: it can
now use **tools that live in other programs** (MCP), it can **see every model your local
servers can load** — LM Studio *and* Ollama in one list — and the chat itself has a
**toolbar** for the working directory, the endpoint and the model.

### Added

- **MCP — Model Context Protocol.** win-agent is now an MCP *client*, so the model can
  call tools implemented by other programs: a filesystem server, git, a database, your own
  service. Two transports are implemented, both from the specification:
  - **stdio** — the agent starts the server as a child process and speaks
    newline-delimited JSON-RPC over its stdin/stdout (handshake, paginated `tools/list`,
    `tools/call`, server-initiated requests answered with an error instead of being left
    hanging). On Windows the command is resolved through `PATHEXT` and `.cmd`/`.bat`
    servers are started through `cmd.exe`, so you write `npx`, not `npx.cmd`.
  - **Streamable HTTP** — one POST per message, with either a JSON reply or an
    `text/event-stream` body, and the `Mcp-Session-Id` header carried between calls.
  - Every advertised tool becomes a normal tool named `mcp__<server>__<tool>` (sanitized
    to `[A-Za-z0-9_-]`, 64 characters max) with the server's own JSON Schema, so it lands
    in the catalog, in the sidebar chips, in *Enabled tools*, and behind the usual
    approval prompt — unless that server is marked **auto-approve**.
  - **A master switch and one switch per server** (`mcpEnabled`, `mcpServers`). MCP is
    **off** by default: while it is off nothing is spawned and no MCP tool is offered.
    A server that is down is a warning in the MCP panel (with the reason and the tools it
    offered last time), never a failed start.
  - The tool list is refreshed at boot, whenever MCP settings change, before every turn
    (cached for two minutes) and on **Reconnect & refresh tools**, so a server you start
    later is picked up without a restart.
  - Settings → *MCP*: a `stdio ↔ HTTP` slider, the command line or URL, an auto-approve
    switch, per-server switches and a status line. Terminal: `/mcp`, `/mcp on|off`,
    `/mcp tools`, `/mcp refresh`, `/mcp enable|disable <id>`, `/mcp add <id> stdio …|http …`,
    `/mcp remove <id>`. API: `GET`/`POST /api/mcp`.
- **Local model sync — every local server in one list.** `syncLocalModels` (on by
  default) makes **Refresh models** / `/models` ask each local endpoint in parallel and
  merge the answers: LM Studio's `/api/v0/models` first (ids *and* context lengths), then
  the OpenAI-compatible `/v1/models`, then Ollama's `/api/tags`. `127.0.0.1:1234` and
  `127.0.0.1:11434` are probed even when no profile points at them, and a server that is
  not running is reported as *no answer* while the others still answer. The picker is
  grouped per server, and **picking a model that lives on another server switches the
  endpoint with it** (`activeProfile` + `model` in one update). The context lengths found
  this way feed `modelContext` and the context planner.
- **Chat toolbar.** Above the composer: the **working directory** (a dropdown of the last
  ten, plus **Browse…**, an in-UI folder picker that walks your drives and folders over
  `GET /api/fs/list`), the **endpoint** and the **model**, plus **Refresh models**. All of
  them apply instantly and are the same settings as everywhere else.
- **New settings**: `mcpEnabled` (false), `mcpServers` (`[]`), `syncLocalModels` (true) and
  `recentWorkdirs` (`[]`, maintained automatically — the folder you left is kept too).
- **[examples/mcp.md](examples/mcp.md)** — a worked walkthrough that starts with a server
  already on disk (the test fixture), then a real `npx` filesystem server, a Streamable
  HTTP server, the same thing over the API and the settings file, and what each error
  message means. Plus `examples/settings.md` (MCP + model-sync settings) and
  `examples/api.md` (the new endpoints).

### Changed

- `POST /api/models` now also returns `endpoints`, `merged` and `context` when
  `syncLocalModels` is on; `GET /api/state` carries the live `mcp` snapshot; the built-in
  tool catalog can grow at runtime (MCP) instead of being fixed at build time.
- The terminal's `/models` lists every local server, and `/status` reports the MCP switch,
  the server count and the tool count.
- New endpoints: `GET`/`POST /api/mcp` and `GET /api/fs/list`.

### Fixed

- **A server that cannot be started no longer costs 15 seconds.** A missing command, a
  non-executable path or a process that dies immediately is detected when the child is
  spawned (`could not start: spawn npx ENOENT`, or the server's own stderr for an
  immediate exit) instead of waiting for the `initialize` timeout.
- The `/mcp tools` listing showed the server's own tool names; it now prints the names the
  model actually calls (`mcp__server__tool`).
- A `kind: "cloud"` profile in a hand-written `settings.json` silently became `local`; it
  is `"api"` (the example file was wrong — the code was not).

### Tests

- `npm run test:mcp` — 49 checks against a mock MCP server
  ([`scripts/fixtures/mock-mcp-server.mjs`](scripts/fixtures/mock-mcp-server.mjs), which you
  can also add as a real server): naming and sanitizing, the handshake, the paginated tool
  list, a server that logs to stdout, a server that never answers, one that cannot start,
  one that does not exist, approval denial, auto-approve, dry run, error results,
  structured content, server-initiated requests, and the HTTP transport with both a JSON
  and an SSE reply.
- `npm run test:models` — 23 checks for local model discovery against mock LM Studio and
  Ollama servers: route layering, merging, `alsoOn`, context lengths, a dead server,
  endpoints with a reduced API, and `localEndpointsFor()` deduplication.
- `npm run test:all` runs all five suites (context, providers, mcp, models, isolation).

## [1.1.1] — 2026-10-18

A patch that makes the "one folder per version" rule airtight, adds the examples folder,
and fixes the four things writing those examples uncovered.

### Added
- **`examples/`** — copy-paste material checked against this repository:
  [tool-calls.md](examples/tool-calls.md) (one worked call per tool, with the JSON the
  model emits), [prompts.md](examples/prompts.md) (ready tasks, English + 中文),
  [custom-commands.md](examples/custom-commands.md), [api.md](examples/api.md) and
  [settings.md](examples/settings.md) (LM Studio / Ollama / cloud `settings.json`).
  `versions/<version>/` copies now include it.
- **Version isolation test** (`npm run test:isolation`): builds three throwaway
  installations, asks one for its folders while standing in another, and fails if any
  copy reports the wrong installation, data folder or version.

### Changed
- **Everything self-resolved is anchored to the installation**, not to the working
  folder: the data folder (`data/`), the version number (`package.json`) and the web UI
  files (`src/web`, `dist/web`). Two copies — in particular two folders under
  `versions/` — can no longer share settings, conversations, totals or UI files, however
  they are started. `AGENT_DATA_DIR` remains the deliberate way to share one folder.
  Existing setups are unaffected when the agent is started from its own folder.
- **`versions/` is published** in the repository, so GitHub shows one folder per version
  next to the working copy; `data/`, `dist/` and `node_modules/` stay local.
- Legacy `.win-agent/` data is looked for in the installation folder first, then in the
  working folder, so a sibling copy cannot pick up someone else's old files.

### Fixed
- **`registry` `get` crashed** with `System.OutOfMemoryException`:
  `Get-ItemProperty` returns `PSProvider`, whose object graph is huge, and
  `ConvertTo-Json` walked all of it. The values are now read on their own, and asking for
  a value or key that does not exist answers with a sentence (and the available names)
  instead of a CLIXML blob.
- **`services` `list` with a filter** only matched the short service name and printed
  `null` when nothing matched: a plain word now behaves as a search over name *and*
  display name (`filter: "print"` finds "Print Spooler") and an empty result says so.
- **A settings file Windows wrote** — a UTF-8 BOM from
  `Set-Content -Encoding UTF8`, Notepad, Visual Studio — made the *whole* file silently
  ignored. BOMs are now stripped when reading settings, conversations, usage totals and
  `package.json`, and a file that genuinely does not parse is reported at startup
  (`warning: ... is not valid JSON ... the defaults are being used`) instead of looking
  like "my settings do not work".

## [1.1.0] — 2026-10-18

Built for small local models that run out of context and for endpoints that only
partly implement the OpenAI API. Everything below is visible and adjustable from the
web UI (`/context`, `/diagnose`, `/caps`, `/version` in the terminal).

### Added
- **Context budgeting.** Every request is measured (CJK-aware token estimate, tool
  schemas included) against the model's window. When it would not fit, the oldest
  complete exchanges are dropped from *that request only* and oversized tool results
  are squeezed head+tail. The conversation on disk is never shortened. Live usage is
  shown in the sidebar and in Settings, with the source of the window.
- **Context length discovery.** LM Studio (`/api/v0/models`) and Ollama (`/api/show`)
  are asked how big each model's context window is, and the answer is remembered per
  model. `contextLimit` overrides it (0 = auto).
- **Request timeouts and retries.** `requestTimeoutMs` (default 180 s — local models
  are slow) and `maxRetries` (default 2) with exponential backoff, honouring
  `Retry-After`. Retries stop as soon as a token has been shown, so nothing is
  duplicated. 429 and 5xx are retried; other 4xx are reported.
- **Endpoint compatibility fallback.** If an endpoint rejects `tools`, `tool_choice`,
  `stream_options` or `stream`, the request is retried without that field, the endpoint
  is remembered as not supporting it for the session, and the UI says so. Models with
  no function calling still work through the documented text protocol.
- **`/diagnose` + "Test this endpoint" button.** Probes reachability, model presence,
  a plain completion, token-usage reporting, native function calling, streaming and
  the context length — one line per check, with a verdict.
- **`/caps`** lists what the active endpoint does not support.
- **`/context`** shows the current estimate, the window, where it came from and what
  was trimmed, in the interface language.
- **`/version`**, the version in the sidebar and in the startup log.
- **Text tool protocol spelled out in the system prompt**, so models that cannot call
  functions are told exactly how to ask for a tool.
- **Version backups, one folder per version.** `npm run release` copies the complete
  agent into `versions/<version>/` (sources, scripts, configs, docs — never
  `node_modules`, `dist` or `data`), writes a `version.json` manifest and refreshes
  `versions/INDEX.md`; `npm run version:list` shows what is on disk. Plus this
  changelog, and a version number shown by the UI/CLI/`/version`.
- **Git history.** `D:\new` is a git repository (PortableGit, installed per-user so no
  admin rights are needed) and `npm run release` tags the commit as `v<version>` once
  the tree is clean, so every version can be found, compared and restored again
  (`git log --oneline --decorate`, `git show v1.1.0`). `npm run version:show` prints
  branch, HEAD, whether the version is tagged and whether anything is uncommitted.
- **Model-free tests**: `npm test` checks the context planner (estimation, squeezing
  before dropping, never orphaning a `tool_calls`, never touching the system prompt);
  `npm run test:providers` drives a mock endpoint to prove the retry and field-fallback
  paths (`npm run test:all` runs both).

### Changed
- `stream`, retries and context handling are one coherent path: the streaming reader,
  the non-streaming JSON path and the retry loop share the same usage accounting, so a
  fallback no longer costs you the token/speed numbers.
- The sidebar Usage panel gained the `context` cell (amber past 75 % of the window).
- The system prompt catalog now also states the text tool protocol, so a model that
  cannot call functions is told how to ask for one.

## [1.0.0] — 2026-10-18

The first complete release: a Windows agent that a small local model can actually drive.

### Added
- One tool per area — `files`, `system`, `processes`, `services`, `network`,
  `scheduled_tasks`, `registry`, `ui`, `powershell`, `custom`, `web` — with flat JSON
  arguments, so `netsh`, `schtasks`, `sc`, `reg` and friends are never typed by hand.
- Approval gate for destructive actions, dry run, and `--yes` for scripts.
- Web UI (dependency-free `node:http` + SSE) with an in-page terminal whose `/commands`
  reconfigure the agent live; full English/Chinese interface and reply language.
- Endpoint profiles: switch the whole agent between a local server and a cloud API with
  one click; each keeps its own URL, key and model.
- 记忆化: conversations, per-call token usage, speed and cache counters, archived
  conversations and cumulative totals, all in one visible `data/` folder.
- Streaming replies with a measured first-token time and output speed, Stop/Esc abort
  (partial history kept), reasoning-model "thinking" indicator.
- `web` tool: `search` (configurable search page), `fetch` (HTML→text or pretty JSON),
  approval-gated `download`.
- `files` `edit` action with a mini diff and offset paging for `read`.
