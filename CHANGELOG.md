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
