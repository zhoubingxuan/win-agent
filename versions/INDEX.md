# win-agent versions

One version = one folder. `versions/<version>/` is a complete copy of the agent at
that version: sources, scripts, configs and docs. `node_modules`, `dist`, `data`
and earlier versions are never copied.

每个版本一个文件夹，里面是这个版本的完整 agent（源码、脚本、配置、文档）；
不含 node_modules、dist、data，也不含其他版本。

## Restore a version

```powershell
cd versions\1.1.0
npm install
npm run web          # or: npm run build && node dist/server.js --no-open
```

Settings and conversations live in the working folder's `data/` folder (or
`AGENT_DATA_DIR`), so a restored copy starts clean unless you copy
`data/settings.json` over to it (it contains your API keys).

Each release is also a git tag (`git show v1.1.0`, `git checkout v1.1.0`).

## Versions

| Version | Backed up | Files | Note |
| --- | --- | --- | --- |
| 1.9.0 | 2026-10-21 14:48 | 81 | One thing changes here: **a turn is no longer a lock on the whole agent**. |
| 1.8.0 | 2026-10-21 14:36 | 81 | Two changes that make the agent *carry more without carrying it in the prompt*. |
| 1.7.0 | 2026-10-21 13:13 | 77 | A small model does not usually fail by being unable to do the task. It fails by repeating itself, by drowning in one huge tool result, and by reading an error… |
| 1.6.0 | 2026-10-19 14:37 | 75 | Two halves of the same promise: the sandbox stops taking tools away and starts *reading* them, and the changes that do get through can be rolled back long after |
| 1.5.1 | 2026-10-19 13:59 | 75 | The agent is fenced into one folder. A file path that points outside the working directory is refused *before* anything is touched, and the two tools that… |
| 1.5.0 | 2026-10-19 13:10 | 71 | How much of the agent's *process* the chat shows is now a slider with three stops, and the model's reasoning becomes something you can read instead of a… |
| 1.4.2 | 2026-10-18 10:20 | 69 |  |
| 1.4.1 | 2026-10-18 09:32 | 68 | A patch for the two things 1.4.0 got wrong in practice, both found by driving a real 7B model through the browser UI: a turn could end with nothing on screen,… |
| 1.4.0 | 2026-10-18 09:07 | 67 | The release that makes a small model **safe to leave alone**: every change it makes is now written down, everything that can be taken back is one `/undo` away,… |
| 1.3.1 | 2026-10-18 08:08 | 64 | A patch that makes the project check itself: **continuous integration** on every push, and three test suites that pin the things that used to be checked by… |
| 1.3.0 | 2026-10-18 07:36 | 60 | Two changes that make the agent better at its actual job: it now **supervises a small local model instead of hoping**, and it **survives the Windows machine it… |
| 1.2.0 | 2026-10-18 06:31 | 54 | Three things that make the agent reach further without making it harder to drive: it can now use **tools that live in other programs** (MCP), it can **see… |
| 1.1.1 | 2026-10-18 05:44 | 49 | A patch that makes the "one folder per version" rule airtight, adds the examples folder, and fixes the four things writing those examples uncovered. |
| 1.1.0 | 2026-10-18 05:01 | 41 | Built for small local models that run out of context and for endpoints that only partly implement the OpenAI API. Everything below is visible and adjustable… |

Written by `npm run release` (`scripts/version.mjs`).
