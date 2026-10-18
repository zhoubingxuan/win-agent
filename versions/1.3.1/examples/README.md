# Examples / 示例

Copy-paste material for every part of win-agent. Everything here is written against
the code in this repository — the JSON below is exactly what the model is expected to
emit, and the terminal lines are exactly what the agent accepts (verified with
`npm run dev -- --list-tools` and by running them).

这里放的是可以直接复制粘贴的示例：给模型看的工具调用 JSON、能直接发给 agent 的任务、
自定义命令、HTTP API 脚本和几份现成的 `settings.json`。

| File | What is in it |
| --- | --- |
| [tool-calls.md](tool-calls.md) | one worked example per tool: the request, the JSON the model emits, what comes back |
| [prompts.md](prompts.md) | ready-to-send tasks (English + 中文), from one tool call to a multi-step job |
| [modes.md](modes.md) | the two agent modes (`guided` / `normal`): what changes, and how to pick one |
| [windows.md](windows.md) | Windows compatibility: PowerShell 5.1/7, elevation, encodings, timeouts |
| [custom-commands.md](custom-commands.md) | turn your own PowerShell one-liners into tools the model can call |
| [mcp.md](mcp.md) | add MCP servers (stdio + HTTP) and use their tools from the chat |
| [api.md](api.md) | drive the agent from PowerShell / curl over the local HTTP API |
| [settings.md](settings.md) | ready `data/settings.json` files: LM Studio, Ollama, a cloud API, MCP |

Two things worth knowing before you read them:

- **The model never writes command lines.** It picks a tool and an `action`; the agent
  builds the PowerShell. That is why the JSON is so small — no quoting, no flags.
- **Anything destructive asks first.** Calls that change the system show an approval
  card in the UI (or `y/n` in the CLI) unless `autoApprove` is on. `dryRun` (`/dry-run on`)
  makes the agent describe what it *would* do and stop.

## Try them without a model / 不用模型也能试

`--list-tools` prints the catalog and the JSON schema of every tool:

```powershell
npm run dev -- --list-tools
```

And the terminal runs single shell lines directly (`/exec`), so you can check a variant
before you hand it to the model:

```powershell
PS> /exec Get-PSDrive C | Select-Object Used,Free
```

> The examples use `D:\new` as the installation folder and `HKCU\Software\win-agent`
> as a scratch registry key. Change the paths to yours.

Every file here is checked by `npm run test:docs`: the links resolve, the files exist,
the settings keys are real, and the commands are implemented. If an example stops
matching the code, CI fails before a reader does.
