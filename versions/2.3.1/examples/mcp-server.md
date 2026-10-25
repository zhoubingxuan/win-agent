# win-agent as an MCP server

The Windows tools, handed to another agent. One flag turns win-agent from an MCP
**client** into an MCP **server**: another program starts it, lists its tools, and
calls them.

```powershell
npm run dev -- --mcp-server
```

That command speaks newline-delimited JSON-RPC 2.0 on stdin/stdout. It prints
nothing else there — human messages go to stderr:

```
win-agent mcp: ready: 15 tools, dry-run off
```

## Wiring it into a client

Claude Desktop (`claude_desktop_config.json`), Cursor, or any client with an
`mcpServers` block:

```json
{
  "mcpServers": {
    "windows": {
      "command": "node",
      "args": ["D:/new/dist/index.js", "--mcp-server"],
      "env": {
        "AGENT_WORKDIR": "D:/work",
        "AGENT_DATA_DIR": "D:/new/data"
      }
    }
  }
}
```

From a checkout without building, use the loader instead:

```json
{
  "mcpServers": {
    "windows": {
      "command": "npx",
      "args": ["tsx", "D:/new/src/index.ts", "--mcp-server"]
    }
  }
}
```

`AGENT_WORKDIR` decides what “the current folder” means for every relative path,
exactly like the chat UI's folder picker. The sandbox setting applies here too: a
path outside the allowed roots is refused with the same message.

## What the client gets

`tools/list` returns the same set the model gets in the chat:

| Tool | Typical use |
| --- | --- |
| `system` | `action: "info"`, `"disk"`, `"memory"`, `"whoami"` — no approval needed |
| `files` | list, tree, read, search, write, edit, copy, move, delete (delete asks for approval) |
| `apply_patch` | apply or preview a unified diff; all-or-nothing, backed up |
| `git` | status, diff, log, add, commit (commit asks first; no push/reset) |
| `tests` | detect and run the project's own npm/pytest/cargo/go/dotnet command |
| `processes` | what is eating the CPU/memory, kill by name or id |
| `services` | status/start/stop without remembering `sc.exe` syntax |
| `network` | adapters, DNS, ping, ports |
| `registry` | read a key, list values |
| `scheduled_tasks` | list, create, delete |
| `ui` | open a file/URL, clipboard, notification |
| `web` | search and read pages |
| `skills` | `list` / `load` / `read` the procedures in `data/skills/` |
| `todo` | the model's own checklist (does not change the machine) |
| `powershell` | the raw shell — **not offered in guided mode** |

The MCP server follows the `agentMode` setting of the copy that starts it. `guided`
withholds `powershell`; `normal` and `expert` offer it. `apply_patch`, `git` and
`tests` are structured tools in every mode, so a client can do a coder turn without
writing a script.

## Skills are prompts too

Installed skills appear in two places. The model can call the `skills` tool, and an
MCP client can ask for them as reusable prompts:

| Request | Answer |
| --- | --- |
| `prompts/list` | every skill in `data/skills/`, with its name, description and when-to-use line |
| `prompts/get` | the skill's body as a user message, so an IDE can insert a procedure into a conversation without starting a win-agent turn |

If no skills are installed, the `prompts` capability is not advertised. A missing
prompt name is `-32602`, not an empty answer.

## Protocol and instructions

`initialize` negotiates one of `2025-06-18`, `2025-03-26` or `2024-11-05` — the newest
version the client asked for that this server also speaks — and echoes it back. It
also returns short `instructions` explaining that these are Windows tools, that
destructive calls may be refused, and that approval can be enabled with
`AGENT_MCP_SERVE_AUTO_APPROVE`. The client can show that text without a separate
documentation lookup.

## Approval: nobody is there to press the button

A client is not a human at this agent's keyboard, so every action that would ask
for **Approve / Deny** is refused:

```json
{ "content": [{ "type": "text", "text": "Cancelled by user." }], "isError": true }
```

and the reason is printed on stderr:

```
win-agent mcp: refused (needs approval, and mcpServeAutoApprove is off): permanently delete D:\work\old.log
```

To let the other agent do destructive work, turn on **Settings → MCP → MCP server
mode: auto-approve**, or start it with `AGENT_MCP_SERVE_AUTO_APPROVE=true`. Every
auto-approval is still logged on stderr, and the change itself still lands in
`data/audit.jsonl` — so **Undo** in the web UI can put it back.

`dryRun` wins over everything: with it on, the tools report what they *would* do.

## A worked example

With the server added as `windows`, ask the other agent:

> Use the windows tools: how much free space is on each drive, and which process is
> using the most memory?

It will call `system` (`action: "disk"`) and then `processes` (`action: "list"`) —
both read-only, so nothing needs approving, and the answer is this machine's, not a
guess.

Then try something destructive:

> Delete every `.log` file in D:\work.

The delete is refused until auto-approve is on. That is the intended default: a
second agent should be able to *look* at your machine before it is allowed to
change it.

## Troubleshooting

| Symptom | What it means |
| --- | --- |
| the client lists no tools | the process failed to start — run the same command in a terminal and read stderr |
| “unknown tool `powershell`” | guided mode withholds the raw shell; switch to `normal` or `expert` in Settings, or use the structured tools |
| every action says `Cancelled by user.` | approval is needed and `mcpServeAutoApprove` is off (this is the safe default) |
| a path is refused | it is outside the working directory / sandbox roots |
| the client shows a parse error | something printed to stdout — that is a bug; the test suite checks it never happens |
