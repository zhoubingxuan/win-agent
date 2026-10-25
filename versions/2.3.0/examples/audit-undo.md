# Audit log and undo / 改动记录与撤销

Every change a tool makes is written to `data/audit.jsonl` — one JSON object per line,
append-only — and every change that can be reversed *faithfully* also goes onto an undo
stack. `/undo` (or **Undo the last change** in Settings → *Change log and undo*) runs
the recorded steps backwards.

## The three ways in / 三种用法

```powershell
# 1. Terminal
PS> /audit                 # the last 15 changes, newest first
PS> /audit 50              # the last 50
PS> /undo                  # reverse the newest one
PS> /undo 3                # reverse the newest three
PS> /undo list             # what could be reversed right now (does not change anything)

# 2. Settings tab -> "Change log and undo"
#    the log file, how many changes can be undone, one button

# 3. HTTP API (see api.md for the general shape)
PS> Invoke-RestMethod http://127.0.0.1:8787/api/audit?n=10 | ConvertTo-Json -Depth 6
PS> Invoke-RestMethod http://127.0.0.1:8787/api/undo -Method Post -ContentType application/json -Body '{"count":1}'
```

## What it looks like

```text
PS> /audit
audit log — 3 record(s), newest first (C:\win-agent\data\audit.jsonl)
5. 2026-10-18 12:04:11  files edit: replaced 1 occurrence(s) in D:\app\config.json  (undoable)
4. 2026-10-18 12:03:58  registry set: set HKCU:\Software\MyApp\theme (DWord)
3. 2026-10-18 12:03:41  files mkdir: created folder D:\app\logs  (undoable)

PS> /undo
undid 1 change(s):
- files mkdir: created folder D:\app\logs
```

One line of `data/audit.jsonl` (pretty-printed here; the file keeps it on one line):

```json
{
  "seq": 3,
  "time": "2026-10-18T12:03:41.512Z",
  "tool": "files",
  "action": "mkdir",
  "summary": "created folder D:\\app\\logs",
  "paths": ["D:\\app\\logs"],
  "undoable": true,
  "steps": [{ "kind": "rmdir", "path": "D:\\app\\logs" }]
}
```

`Get-Content data\audit.jsonl -Tail 20` is the raw view; `Tool` / `Action` / `Summary`
say what happened, `Undoable` says whether `/undo` can take it back, and `Steps` is
what `/undo` would run.

## What can be undone / 可以撤销的操作

| You did | `/undo` does |
| --- | --- |
| `files write` / `append` / `edit` on an existing file | puts the old bytes back (encoding and BOM included) |
| `files write` / `append` on a new file | deletes it |
| `files delete` | restores the file — or the whole folder tree |
| `files move` | moves it back, and restores the file it replaced |
| `files mkdir` | removes the folder, only while it is still empty |
| `files copy` that created something new | deletes the copy |
| `registry set` | writes the previous value back with its original type; removes it if it did not exist |
| `registry delete` | writes the value back |
| `system env_set` | restores the previous value, or removes the variable |
| `scheduled_tasks create` of a new task | unregisters the task |
| `scheduled_tasks delete` | re-registers the exported task definition |

Everything else is recorded but marked **not undoable** — the log line just has no
`(undoable)` marker:

- `copy` and `unzip` that overwrote existing files, and any change whose previous
  state could not be read,
- anything bigger than 64 MB (the copy would cost more than the change),
- actions with no inverse: starting a service or process, `shutdown`, `ui`, the
  clipboard, firewall and network changes.

The two raw-script escape hatches are recorded as well — `powershell` with the first
200 characters of the script, your own `custom` commands with the command and its
argument, and MCP tool calls with the server, tool and arguments — but nothing about
them is undoable: what a script did cannot be described, only quoted.

Undo asks for no approval, but it is refused while the agent is running a turn (the API
answers `409`), so it can never race the model over the same file.

Two limits, stated plainly:

- the undo stack is **in memory**: a restart clears it (the log keeps the record);
- `data/undo/` — where the "put it back" copies live — is emptied on every start,
  because nothing can reference those copies any more.

## Turning it off / 关闭

```powershell
PS> /set auditLog off
```

Nothing is written and nothing can be undone (the terminal and the API both say so).
Files are not copied aside either, so an agent with the log off is faster and leaves no
copies behind. Turn it back on with `/set auditLog on`, the switch in the Settings tab,
or `$env:AGENT_AUDIT_LOG = "true"`.

## Why this exists

A local model with file, registry and scheduled-task access *will* eventually do
something you did not mean. Two things make that survivable: the log tells you exactly
what it did, in order, and `/undo` takes back the part that can be taken back without
guessing. For the rest there is `dryRun` (`/dry-run on`), which describes every change
and performs none — the safest way to watch a small model work.
