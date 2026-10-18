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
| 1.4.0 | 2026-10-18 09:07 | 67 | The release that makes a small model **safe to leave alone**: every change it makes is now written down, everything that can be taken back is one `/undo` away,… |
| 1.3.1 | 2026-10-18 08:08 | 64 | A patch that makes the project check itself: **continuous integration** on every push, and three test suites that pin the things that used to be checked by… |
| 1.3.0 | 2026-10-18 07:36 | 60 | Two changes that make the agent better at its actual job: it now **supervises a small local model instead of hoping**, and it **survives the Windows machine it… |
| 1.2.0 | 2026-10-18 06:31 | 54 | Three things that make the agent reach further without making it harder to drive: it can now use **tools that live in other programs** (MCP), it can **see… |
| 1.1.1 | 2026-10-18 05:44 | 49 | A patch that makes the "one folder per version" rule airtight, adds the examples folder, and fixes the four things writing those examples uncovered. |
| 1.1.0 | 2026-10-18 05:01 | 41 | Built for small local models that run out of context and for endpoints that only partly implement the OpenAI API. Everything below is visible and adjustable… |

Written by `npm run release` (`scripts/version.mjs`).
