# HTTP API examples / 用 HTTP 调它

The web UI is a plain client of a local, dependency-free HTTP server on
`http://127.0.0.1:8787` (change it in Settings, or `POST /api/port`). Everything the
UI does, you can script.

网页界面本身就是这个本地 HTTP 服务器的客户端。下面的脚本用的是真接口，可以直接跑。

Start it first:

```powershell
npm run web                # tsx, dev
# or, from a built copy:
npm run build; npm run start:web
```

## Read-only / 只读

```powershell
$base = "http://127.0.0.1:8787"

# Where does it keep its stuff, which version, which model, which tools?
Invoke-RestMethod "$base/api/state" | Select-Object version, cwd, model, enabledTools, dataDir

# Token totals of the open conversation + all time
Invoke-RestMethod "$base/api/usage"

# The data folder, the open conversation, the archived list
Invoke-RestMethod "$base/api/data"

# Public settings + where the settings file is
Invoke-RestMethod "$base/api/settings"

# Which models does the active endpoint serve? (also remembers their context length)
Invoke-RestMethod "$base/api/models"

# ...for another endpoint
Invoke-RestMethod "$base/api/models?profile=cloud"

# With syncLocalModels on, the same call also merges every local server:
#   .endpoints  one entry per local server (id, label, baseUrl, ok, source, models, error)
#   .merged     all models, each with .endpointId
#   .context    model -> context length
(Invoke-RestMethod "$base/api/models").merged | Format-Table id, endpointId

# MCP: master switch + one entry per server, with live state
Invoke-RestMethod "$base/api/mcp"

# The folder picker: sub-folders of a path (an empty path lists the drives)
Invoke-RestMethod "$base/api/fs/list?path=D%3A%5Cnew"
```

## Send a task / 发一个任务

`POST /api/chat` starts the turn and returns immediately; the answer arrives on the event
stream, exactly like in the UI.

```powershell
Invoke-RestMethod -Method Post "$base/api/chat" -ContentType application/json `
  -Body '{"message":"How much free space is left on C:?"}'
```

Watch it, including every tool call, in one terminal (Ctrl+C to stop):

```powershell
curl.exe -N "$base/api/events"
```

A filtered view of just the final text and the tool calls:

```powershell
curl.exe -N "$base/api/events" | Select-String '"type":"(tool_call|tool_result|done)"'
```

## Change settings / 改设置

`POST /api/settings` takes a partial object and returns what actually changed:

```powershell
Invoke-RestMethod -Method Post "$base/api/settings" -ContentType application/json `
  -Body '{"language":"zh","maxSteps":20,"stream":true}'
```

```powershell
# switch the model on the active endpoint
Invoke-RestMethod -Method Post "$base/api/settings" -ContentType application/json `
  -Body '{"model":"qwen2.5:14b"}'

# hide the escape hatch from the model
Invoke-RestMethod -Method Post "$base/api/settings" -ContentType application/json `
  -Body '{"enabledTools":["files","system","processes","services","network","web"]}'

# back to every tool
Invoke-RestMethod -Method Post "$base/api/settings" -ContentType application/json -Body '{"enabledTools":null}'

# re-read data/settings.json from disk
Invoke-RestMethod -Method Post "$base/api/settings/reload"
```

Endpoints (profiles) have their own call:

```powershell
Invoke-RestMethod -Method Post "$base/api/profiles" -ContentType application/json -Body '{"action":"use","id":"local"}'
```

## MCP servers / MCP 服务器

`POST /api/mcp` manages the servers the same way the Settings tab does. Every action
returns the fresh `mcp` snapshot (`enabled`, `totalTools`, `servers[]{connected, liveTools, error}`).

```powershell
$base = "http://127.0.0.1:8787"

# the master switch
Invoke-RestMethod -Method Post "$base/api/settings" -ContentType application/json -Body '{"mcpEnabled":true}'

# add a stdio server (a command line, started as a child process)
Invoke-RestMethod -Method Post "$base/api/mcp" -ContentType application/json -Body '{
  "action":"add","id":"fs",
  "server":{"transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","D:\\new"]}}'

# add a Streamable-HTTP server that does not ask for approval
Invoke-RestMethod -Method Post "$base/api/mcp" -ContentType application/json -Body '{
  "action":"add","id":"docs",
  "server":{"transport":"http","url":"http://127.0.0.1:3001/mcp","autoApprove":true}}'

# reconnect and re-read the tool lists
Invoke-RestMethod -Method Post "$base/api/mcp" -ContentType application/json -Body '{"action":"refresh"}'

# one server off, then on
Invoke-RestMethod -Method Post "$base/api/mcp" -ContentType application/json -Body '{"action":"toggle","id":"fs","enabled":false}'

# what did the model actually get?
(Invoke-RestMethod "$base/api/state").allTools | Where-Object { $_ -like "mcp__*" }

# delete it
Invoke-RestMethod -Method Post "$base/api/mcp" -ContentType application/json -Body '{"action":"remove","id":"fs"}'
```

The same from the terminal, which is shorter for a one-off:

```powershell
Invoke-RestMethod -Method Post "$base/api/terminal" -ContentType application/json `
  -Body '{"input":"/mcp add fs stdio npx -y @modelcontextprotocol/server-filesystem D:\\new"}'
```

## The working directory from a script

`recentWorkdirs` is maintained for you; the picker in the chat toolbar is fed by
`GET /api/fs/list` and the setting below:

```powershell
Invoke-RestMethod -Method Post "$base/api/settings" -ContentType application/json -Body '{"workdir":"D:\\new\\sandbox"}'
(Invoke-RestMethod "$base/api/settings").recentWorkdirs
```

## Terminal and approvals / 终端与审批

`POST /api/terminal` is the web terminal: shell lines and `/commands` are one round trip.

```powershell
Invoke-RestMethod -Method Post "$base/api/terminal" -ContentType application/json -Body '{"input":"/status"}'
Invoke-RestMethod -Method Post "$base/api/terminal" -ContentType application/json -Body '{"input":"/model qwen2.5:14b"}'
Invoke-RestMethod -Method Post "$base/api/terminal" -ContentType application/json -Body '{"input":"Get-PSDrive C | Select-Object Used,Free"}'
```

Firewall edit / zip / delete, all in one line, if you want it as a custom command:

```powershell
Invoke-RestMethod -Method Post "$base/api/terminal" -ContentType application/json `
  -Body '{"input":"/custom add myip (Invoke-RestMethod https://api.ipify.org)"}'
```

When a destructive tool stops for approval, the request arrives on the event stream:

```
{"type":"approval","id":"...","summary":"delete D:\\new\\tmp (recursive)"}
```

Answer it (this is the same thing the Approve button does):

```powershell
Invoke-RestMethod -Method Post "$base/api/approve" -ContentType application/json -Body '{"id":"<id from the event>","approved":true}'
```

## Conversations / 会话

```powershell
# file the open conversation away and start a new one
Invoke-RestMethod -Method Post "$base/api/reset"

# list them, then reopen one
Invoke-RestMethod "$base/api/conversations"
Invoke-RestMethod -Method Post "$base/api/conversations" -ContentType application/json -Body '{"action":"load","id":"2026-10-18_10-15-33"}'
```

## Stop it / 打断

```powershell
Invoke-RestMethod -Method Post "$base/api/abort"      # stop the running turn
```

## Other ports / 换端口

```powershell
Invoke-RestMethod -Method Post "$base/api/port" -ContentType application/json -Body '{"port":9000}'
```

The server rebinds live and rolls back if the port is taken — no restart, and the tabs
that are open are told about it.

## From another language

`curl` is enough — the body is plain JSON:

```bash
curl -s -X POST http://127.0.0.1:8787/api/terminal \
  -H "Content-Type: application/json" \
  -d '{"input":"/version"}'
```

Two things to know when writing your own client:

- The server binds `127.0.0.1` only, on purpose — there is no auth, so do not expose it.
- Tool calls can change the machine, so a client that sends `/api/chat` should also listen
  for `approval` events (or the request will simply time out waiting for an answer).
