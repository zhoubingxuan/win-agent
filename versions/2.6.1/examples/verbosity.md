# Output detail — `answer` / `thinking` / `full` / 输出详细程度

A small model chatters. "How much space is left on C:?" can be one tool call or a dozen,
and a reasoning model says an awful lot before it says anything. `verbosity` is the
slider that decides how much of that the chat log *draws*.

| Level | Default for | The log shows |
| --- | --- | --- |
| `answer` | **daily use** | your message and the model's answer. Nothing else. |
| `thinking` | watching a reasoning model | the above, plus the model's reasoning in a foldable block |
| `full` | debugging a model or a prompt | everything: reasoning, every tool call with its arguments and result, `step 3/12` markers, per-call token counts |

**It is a view setting.** The agent calls the same tools with the same arguments at every
level; only the drawing changes. The full record is written to `data/history.json`
whatever the slider says, so moving it up later shows you what past turns were doing.

## Switching / 切换

Four identical ways — all of them write the same setting:

```powershell
# 1. the chat toolbar: the three-stop "detail" slider (applies at once)
# 2. Settings -> "Output detail": the same slider, with the meaning spelled out
# 3. terminal:
PS> /verbosity                 # print the current level
PS> /verbosity answer          # only the answers
PS> /verbosity thinking        # + the model's reasoning
PS> /verbosity full            # the machine room
# 4. any setting surface:
PS> /set verbosity full
PS> /unset verbosity           # back to the default (answer)
```

```jsonc
// data/settings.json
{ "verbosity": "thinking" }
```

```powershell
# or per shell, no file change:
$env:AGENT_VERBOSITY = "full"; npm run web
```

`normalizeVerbosity` accepts aliases: `answer`, `minimal`, `quiet`, `只显示回答`, `最简`
→ `answer`; `thinking`, `think`, `thoughts`, `reasoning`, `medium`, `思考`, `中等`, `过程`
→ `thinking`; `full`, `strong`, `verbose`, `all`, `everything`, `强`, `完全`, `详细`, `全部`
→ `full`. Anything else, or no `verbosity` at all, means `answer`.

## The same turn at all three levels

Task: *`C 盘还剩多少空间？`* — a reasoning model that calls `system` once and then answers.

### `answer` (the default)

```
┌──────────────────────────────────────────────┐
│ C 盘还剩多少空间？                             │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ C: 还有 41.2 GB 可用，总共 237.9 GB（已用 82.6%）。 │
└──────────────────────────────────────────────┘
```

Two bubbles. While the turn runs the title bar reads **Working…** and the **Stop** button
is there; when it ends you have the answer. Approval prompts and errors *always* appear —
`answer` hides the process, never a question you have to answer.

### `thinking`

```
┌──────────────────────────────────────────────┐
│ C 盘还剩多少空间？                             │
└──────────────────────────────────────────────┘
▸ 思考（1 284 字符）—— 点击展开
┌──────────────────────────────────────────────┐
│ C: 还有 41.2 GB 可用，总共 237.9 GB（已用 82.6%）。 │
└──────────────────────────────────────────────┘
```

The block arrives **open and growing** while the model thinks (its summary counts the
characters as they come), and folds itself the moment the answer starts — a wall of
reasoning would push the answer off the screen. It stays in the log, folded, and a
reload replays it folded too: click it to read what the model was thinking.

### `full`

```
┌──────────────────────────────────────────────┐
│ C 盘还剩多少空间？                             │
└──────────────────────────────────────────────┘
▸ 思考（1 284 字符）—— 点击展开
... step 2/12
┌─ system ─────────────────────────────────────┐
│ { "action": "disk" }                          │
│ ───────────────────────────────────────────── │
│ C:\  237.9 GB total, 41.2 GB free, 82.6% used │
└──────────────────────────────────────────────┘
↑831 ↓96 (64 reasoning) · 204.0 tok/s · 0.8s
┌──────────────────────────────────────────────┐
│ C: 还有 41.2 GB 可用，总共 237.9 GB（已用 82.6%）。 │
└──────────────────────────────────────────────┘
```

Tool cards start **collapsed** and grow a red border when the result is an error or a
non-zero exit code; the token line under each call is that call's usage. This is the
level to watch when a model keeps picking the wrong tool, or when you want to see
whether the answer came from the tool or from the model's imagination.

## What is stored, and what is sent

| | `answer` | `thinking` | `full` |
| --- | --- | --- | --- |
| `data/history.json` gets the tool calls and results | yes | yes | yes |
| … and the reasoning, per assistant message | yes (capped at 20 000 chars) | yes | yes |
| the reasoning is sent back to the endpoint | **no** | **no** | **no** |

The reasoning is stored so the slider can be moved up later, and it is stripped from
every request on the way out — an endpoint that rejects unknown fields would choke on
it, and a model that reads its own thinking back starts arguing with itself.

## The terminal

The CLI follows the same setting at its two ends: on `answer` it prints the answers
(plus approval prompts and errors), on `full` it prints its `step` / `-> tool` /
`<- result` lines. It starts by printing which level it is on:

```
  detail: answer (set verbosity=full to watch the tool calls)
```

It has nowhere to fold a reasoning block, so the reasoning itself is a chat-view thing —
use `thinking` in the web UI, or `full` if you want the whole picture in one place.
