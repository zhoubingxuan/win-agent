# MCP servers / MCP 服务器

[MCP](https://modelcontextprotocol.io) lets the agent use tools that live in another
program — a filesystem server, git, a database, your own service. win-agent is the
*client*: you tell it how to start (or reach) a server, and every tool that server
advertises becomes a tool the model can call, named `mcp__<server>__<tool>`.

MCP is **off** until you switch it on, because a server is a program that runs with
your rights.

> All commands below were run against the code in this repository, and the first one
> needs **nothing installed** — it uses the mock server that ships in
> [`scripts/fixtures/mock-mcp-server.mjs`](../scripts/fixtures/mock-mcp-server.mjs),
> which the test suite uses too.

---

## 1. A demo server that is already on your disk

Start the agent (or keep it running) and add the fixture:

```
PS D:\new> /mcp add demo stdio node D:\new\scripts\fixtures\mock-mcp-server.mjs
updated: mcpServers, mcpEnabled
MCP master switch: on (1 server(s) configured)
  demo           stdio connected, 5 tool(s)
```

The five tools it pretends to have are `echo`, `weird.name/x`, `fail`, `structured`
and `sampling`. What the model sees:

```
PS D:\new> /mcp tools
MCP tools the model can call (5):
- mcp__demo__echo
- mcp__demo__weird_name_x
- mcp__demo__fail
- mcp__demo__structured
- mcp__demo__sampling
```

Note the second name: `weird.name/x` is not a legal function name (dots and slashes
are not allowed), so it is sanitized to `mcp__demo__weird_name_x`, the same name the
model uses. The sidebar **Tools** chips show exactly the same names.

Call it from the chat:

```
you> use the mcp demo tool to echo the word banana

  -> mcp__demo__echo {"text":"banana"}          [Approve] [Deny]
  <- echo: banana

The demo MCP tool echoed "banana".
```

The call asks for approval because a server you just added is not trusted; flip
**auto-approve** on that server (or set `autoApprove`) if you would rather not be
asked. `dryRun` reports the call without making it.

Remove it again:

```
PS D:\new> /mcp remove demo
updated: mcpServers
MCP master switch: on (0 server(s) configured)
(no MCP servers - /mcp add <id> stdio <command> [args...])
```

---

## 2. A real stdio server — filesystem

The reference filesystem server is a Node package, so the first run downloads it:

```
PS D:\new> /mcp add fs stdio npx -y @modelcontextprotocol/server-filesystem D:\
MCP master switch: on (1 server(s) configured)
  fs             stdio connected, 11 tool(s)
```

```
PS D:\new> /mcp tools
MCP tools the model can call (11):
- mcp__fs__read_file
- mcp__fs__write_file
- mcp__fs__edit_file
- mcp__fs__create_directory
- mcp__fs__list_directory
- mcp__fs__directory_tree
- mcp__fs__move_file
- mcp__fs__search_files
- mcp__fs__get_file_info
- mcp__fs__list_allowed_directories
- mcp__fs__read_multiple_files
```

```
you> with the fs MCP tool, list D:\new and tell me which folders are there

  -> mcp__fs__list_directory {"path":"D:\\new"}      [Approve] [Deny]
  <- [DIR] .git
     [DIR] data
     [DIR] examples
     ...

D:\new contains these folders: .git, data, examples, scripts, src, versions.
```

On Windows you write `npx`, not `npx.cmd`: the agent resolves the command through
`PATHEXT` and starts `.cmd`/`.bat` servers through `cmd.exe`. `uvx`, `python`,
`docker` and absolute paths work the same way.

The last argument (`D:\`) is the directory the server is *allowed* to touch — the
server enforces it, and the agent only ever calls the tools the server advertises.

---

## 3. A real HTTP server — Streamable HTTP

If the server already runs as a service (or is a container you do not want to spawn
per session), give the agent its URL instead:

```
PS D:\new> /mcp add docs http http://127.0.0.1:3001/mcp
MCP master switch: on (2 server(s) configured)
  docs           http  connected, 3 tool(s)
```

The same from the Settings tab: fill in an `id`, slide **stdio ↔ HTTP** to **HTTP**,
paste the URL, press **Add server**.

The transport is *Streamable HTTP*: one POST per JSON-RPC message, and the reply may
be `application/json` or an `text/event-stream` body. An old **SSE-only** server is not
spoken to directly — put an HTTP bridge such as
[`mcp-proxy`](https://github.com/sparfenyuk/mcp-proxy) in front of it and add the
bridge's URL.

---

## 4. The same thing from the API / settings file

```powershell
# add a stdio server
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/mcp -ContentType application/json `
  -Body '{"action":"add","id":"fs","server":{"transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","D:\\"]}}'

# add an HTTP server that runs without asking for approval
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/mcp -ContentType application/json `
  -Body '{"action":"add","id":"docs","server":{"transport":"http","url":"http://127.0.0.1:3001/mcp","autoApprove":true}}'

# what is live right now?
(Invoke-RestMethod http://127.0.0.1:8787/api/mcp).servers | Format-Table id, transport, connected, enabled
```

In `data/settings.json` the same two servers look like this (see
[settings.md](settings.md) for a full file):

```json
{
  "mcpEnabled": true,
  "mcpServers": [
    {
      "id": "fs",
      "name": "fs",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\"],
      "env": {},
      "url": "",
      "enabled": true,
      "autoApprove": false,
      "tools": []
    },
    {
      "id": "docs",
      "name": "docs",
      "transport": "http",
      "command": "",
      "args": [],
      "env": {},
      "url": "http://127.0.0.1:3001/mcp",
      "enabled": true,
      "autoApprove": true,
      "tools": []
    }
  ]
}
```

`env` is passed to a stdio server as environment variables, for example
`{"GITHUB_TOKEN":"ghp_..."}`. It is stored in `data/settings.json` like your API key
is — the file is local-only and never served to another machine.

---

## 5. Day-to-day commands

| Command | What it does |
| --- | --- |
| `/mcp` | master switch, one line per server: transport, connection state, tool count, last error |
| `/mcp on` · `/mcp off` | the master switch; off stops every server and hides their tools from the model |
| `/mcp tools` | every `mcp__server__tool` name the model can call |
| `/mcp refresh` | reconnect and re-read the tool lists (the UI button is *Reconnect & refresh tools*) |
| `/mcp enable <id>` · `/mcp disable <id>` | one server on/off, without deleting it |
| `/mcp add <id> stdio <command> [args...]` | add a stdio server |
| `/mcp add <id> http <url>` | add an HTTP server |
| `/mcp remove <id>` | delete a server |

The tool list is refreshed at boot, whenever MCP settings change, before every turn
(cached for two minutes) and on demand — so a server you start *later* is picked up
without restarting the agent. If a server is down, `/mcp` says so and the agent keeps
working with the tools it still has.

---

## 6. When something goes wrong

| Symptom | What it means |
| --- | --- |
| `not connected` + `spawn node ENOENT` | `node` is not on `PATH` for the agent's process; use `"%ProgramFiles%\nodejs\node.exe"` or fix `PATH` |
| `not connected` + a message from the server | the server itself failed to start — its own stderr is quoted in the panel |
| `no answer to initialize within 15s` | the command started but never spoke MCP; check you did not point at a plain script |
| `no answer to tools/list within 15s` | the handshake worked but the server is stuck — try it by hand |
| `unknown MCP tool mcp__x__y` | the name is not in the last tool list: `/mcp refresh`, or `/mcp tools` to see the real names |
| The tools never reach the model | master switch off, server off, or the tools are unchecked in *Enabled tools* |

MCP is a *tool source*, not a security boundary: a server runs as your Windows user
and can do whatever you can. Add only servers you trust, and leave
**auto-approve** off unless you wrote it yourself.
