# MCP servers / MCP 服务器

[MCP](https://modelcontextprotocol.io) lets the agent use tools that live in another
program — a filesystem server, git, a database, your own service. win-agent is the
*client*: you tell it how to start (or reach) a server, and every tool that server
advertises becomes a tool the model can call, named `mcp__<server>__<tool>`.

MCP is **off** until you switch it on, because a server is a program that runs with
your rights.

> The first example needs **nothing installed** — it uses the mock server that ships in
> [`scripts/fixtures/mock-mcp-server.mjs`](../scripts/fixtures/mock-mcp-server.mjs),
> which the test suite uses too.

---

## 1. A demo server that is already on your disk

Start the agent (or keep it running) and add the fixture:

```
PS D:\new> /mcp add demo stdio node D:\new\scripts\fixtures\mock-mcp-server.mjs
updated: mcpServers, mcpEnabled
MCP master switch: on (1 server(s) configured)
  demo           stdio connected, 5 tool(s) +2R/1P
```

The five tools it pretends to have are `echo`, `weird.name/x`, `fail`, `structured`
and `sampling`. It also advertises **two resources** and **one prompt**, which is how
the 2.3 context path is exercised.

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
model uses. Names are capped at 64 characters; if two servers produce the same name,
the second gets a suffix instead of silently replacing the first. The sidebar **Tools**
chips show exactly the same names.

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

### Resources and prompts: one tool, not two hundred

A server can offer documents (`resources`) and reusable prompt templates (`prompts`).
Instead of turning each one into a separate function, win-agent registers one
**`mcp_context`** tool — and only while a connected server actually has context:

```
you> list the context the demo MCP server offers
  -> mcp_context {"action":"list"}
  <- MCP servers:
     - demo (mock-mcp 1.0.0): 5 tool(s), 2 resource(s), 1 prompt(s)

     Resources (2):
     - demo: mock://doc (Mock document) [text/plain]
     - demo: mock://other (Other) [text/plain]

     Prompts (1):
     - demo: greet — Greet someone args: name*

you> read mock://doc and render the greet prompt for Ada
  -> mcp_context {"action":"read","uri":"mock://doc"}
  <- resource body
  -> mcp_context {"action":"prompt","name":"greet","arguments":{"name":"Ada"}}
  <- hello Ada
```

`action: "read"` and `action: "prompt"` record what they read in the audit log. The
`server` argument is only needed when two servers expose the same URI/name.

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

A stdio server can also have:

- **`cwd`** — the working directory it starts in (default: the agent's folder);
- **`env`** — extra environment variables;
- **`timeoutMs`** — one request's limit (default 20 s, clamped to 1–600 s).

`${VAR}`, `${env:VAR}` and `%VAR%` are expanded in `command`, `args`, `env`, `cwd`,
`url` and `headers`. A missing variable becomes an empty string, so an absent secret
fails closed instead of sending the literal `${TOKEN}`.

---

## 3. A real HTTP server — Streamable HTTP

If the server already runs as a service (or is a container you do not want to spawn
per session), give the agent its URL instead:

```
PS D:\new> /mcp add docs http http://127.0.0.1:3001/mcp
MCP master switch: on (2 server(s) configured)
  docs           http  connected, 3 tool(s)
```

Headers are added in **Settings → MCP → Edit**, for example:

```json
{ "Authorization": "Bearer ${DOCS_TOKEN}", "X-Client": "win-agent" }
```

They are sent with every POST (and with the SSE handshake for `sse`). The transport is
*Streamable HTTP*: one POST per JSON-RPC message, and the reply may be
`application/json` or an `text/event-stream` body.

An old **SSE-only** server (one long-lived `GET` stream plus a POST endpoint) uses
the `sse` transport directly — no bridge needed:

```
PS D:\new> /mcp add legacy sse http://127.0.0.1:3001/sse
  legacy         sse   connected, 2 tool(s)
```

The command form is:

```
/mcp add <id> stdio <command> [args...]
/mcp add <id> http|sse <url>
```

---

## 4. The same thing from the settings UI, API or file

**Settings → MCP** gives you a card per server with **Edit**, **Test**, **Reconnect**
and **Remove**. *Test* starts the candidate, performs the handshake, lists its tools,
resources and prompts, and stops it again without touching the live connection. The
card also has one policy select per tool:

| Policy | Effect |
| --- | --- |
| `allow` | run without asking |
| `ask` | show Approve / Deny (the default unless the server is auto-approved) |
| `deny` | do not offer this tool to the model at all |

A tool policy overrides the server's auto-approve switch. For example, keep
`write_file` and `delete` on `ask`, but let `read_file` run freely.

The **import box** accepts an `mcpServers` object copied from Claude Desktop, Cursor,
VS Code or another client:

```json
{
  "mcpServers": {
    "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\"] },
    "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer x" } }
  }
}
```

New ids are added; an existing id is updated in place (no `_2` duplicate). A URL that
ends in `/sse` is imported as `sse`; anything else with a URL is `http`. The API action
is `{"action":"import","config":{...}}`.

```powershell
# add a stdio server
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/mcp -ContentType application/json `
  -Body '{"action":"add","id":"fs","server":{"transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","D:\\"]}}'

# test a candidate without saving it
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/mcp -ContentType application/json `
  -Body '{"action":"test","id":"fs","server":{"transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","D:\\"]}}'

# add an HTTP server with a header and a per-tool policy
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/mcp -ContentType application/json `
  -Body '{"action":"add","id":"docs","server":{"transport":"http","url":"http://127.0.0.1:3001/mcp","headers":{"Authorization":"Bearer ${DOCS_TOKEN}"},"toolPolicies":{"search":"allow","delete":"deny"}}}'

# what is live right now?
(Invoke-RestMethod http://127.0.0.1:8787/api/mcp).servers | Format-Table id, transport, connected, enabled
```

In `data/settings.json` a stdio server and an HTTP server look like this (see
[settings.md](settings.md) for a full file):

```json
{
  "mcpEnabled": true,
  "mcpRefreshSeconds": 120,
  "mcpServers": [
    {
      "id": "fs",
      "name": "fs",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\"],
      "env": {},
      "cwd": "D:\\work",
      "url": "",
      "headers": {},
      "enabled": true,
      "autoApprove": false,
      "toolPolicies": { "write_file": "ask", "read_file": "allow" },
      "timeoutMs": 20000,
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
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "enabled": true,
      "autoApprove": false,
      "toolPolicies": {},
      "timeoutMs": 20000,
      "tools": []
    }
  ]
}
```

`env` and `headers` are stored in `data/settings.json` like your API key is — the
file is local-only and never served to another machine. Prefer `${VAR}` references
when you can, so the secret stays in the environment instead of the file.

---

## 5. Day-to-day commands

| Command | What it does |
| --- | --- |
| `/mcp` | master switch, one line per server: transport, connection, tool count, `+nR/nP` resources/prompts, last error |
| `/mcp on` · `/mcp off` | the master switch; off stops every server and hides their tools from the model |
| `/mcp tools` | every `mcp__server__tool` name the model can call |
| `/mcp refresh` | reconnect and re-read the lists (the UI button is *Reconnect & refresh tools*) |
| `/mcp enable <id>` · `/mcp disable <id>` | one server on/off, without deleting it |
| `/mcp add <id> stdio <command> [args...]` | add a stdio server |
| `/mcp add <id> http\|sse <url>` | add a remote server |
| `/mcp remove <id>` | delete a server |

The cache is refreshed at boot, whenever MCP settings change, and before a turn when
it is older than `mcpRefreshSeconds` (default 120, range 10–3600). A server that sends
`notifications/*/list_changed` marks its lists dirty, so the next turn re-reads them
without reconnecting. **Reconnect & refresh tools** forces a fresh process now.

If a server is down, `/mcp` says so and the agent keeps working with the tools it
still has. A failed call reconnects once and retries; background retries wait 2 s,
5 s, 15 s, 60 s, then every 5 minutes.

---

## 6. When something goes wrong

| Symptom | What it means |
| --- | --- |
| `not connected` + `spawn node ENOENT` | `node` is not on `PATH` for the agent's process; use `"%ProgramFiles%\nodejs\node.exe"` or fix `PATH` |
| `not connected` + a message from the server | the server itself failed to start — its own stderr is quoted in the panel |
| `no answer to initialize within 15s` | the command started but never spoke MCP; check you did not point at a plain script |
| `no answer to tools/list within 20s` | the handshake worked but the server is stuck — try **Test** in the UI, or run it by hand |
| `unknown MCP tool mcp__x__y` | the name is not in the last tool list: `/mcp refresh`, or `/mcp tools` to see the real names |
| The tools never reach the model | master switch off, server off, the tool is `deny`, or it is unchecked in *Enabled tools* |
| A resource/prompt is missing | the server did not advertise `resources`/`prompts` in its handshake; refresh and check the card |
| A header is empty although you set it | the `${VAR}` it references is not set in the agent's process, so it expands to an empty string |

MCP is a *tool source*, not a security boundary: a server runs as your Windows user
and can do whatever you can. Add only servers you trust, keep **auto-approve** off,
and use `deny` for individual tools you do not want the model to reach.
