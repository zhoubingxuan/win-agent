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
