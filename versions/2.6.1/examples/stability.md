# Staying on the rails / 别让小模型烧掉整个回合

A small model rarely fails by being unable to do the task. It fails by repeating
itself, by drowning in one huge tool result, or by reading an error message as "try
again". Three mechanisms handle those, and all of them are visible in the chat log.

See the [Staying on the rails](../README.md#staying-on-the-rails) section in the README
for the switches (`loopGuard`, `maxSteps`, `psEnglishErrors`).

## 1. The same call, over and over / 原地打转

Task: *"看看 D:\logs\app.log 里最近有什么错"*. The model reads the file, does not find
what it wanted, and asks for the identical call again:

```json
{ "tool": "files", "arguments": { "action": "read", "path": "D:\\logs\\app.log" } }
```

The first two runs are normal. On the third, the agent does **not** run it again — the
same call with the same answer twice means nothing is going to change:

```text
Blocked: this exact call (files {"action":"read","path":"D:\\logs\\app.log"}) has already
returned the same result twice, so running it again cannot change anything. Change the
argument, use another tool, or tell the user what you have found.
```

What happens next is the point of the message: it names the call, says why it is a dead
end, and gives three ways out. A model that reads it either narrows the call
(`grep` inside the file, `read` with `offset`), tries another tool, or answers.

What it does **not** block, because these are not dead ends:

| Situation | Why it keeps running |
| --- | --- |
| the same call twice in a row while the answer changes (a poll) | the *answer* is the signal: something is still happening |
| a call with a different argument | that is a different question |
| the same call after another call in between | the state may have changed |
| `loopGuard: false` | plain step-by-step execution, exactly as before 1.7 |

## 2. The step limit / 步数上限

The model keeps going — reading, listing, grepping, never answering. After `maxSteps`
rounds the turn stops, and the message says what happened and how to carry on:

```text
(stopped after 12 steps without finishing: the "Max steps" limit was reached. Send
"continue" and I will carry on; you can also raise "Max steps" in Settings, or split the
task into smaller pieces.)
```

```text
（已连续执行 12 步仍未完成：达到“最大步数”上限。发送“继续”会接着做；也可以在 Settings
里把最大步数调大，或者把任务拆小一点。）
```

The limit is a *pause*, not a failure: the conversation and the tool results are still
there, so the next message continues from the same place. Raising `maxSteps` in Settings
(changes apply at once) is the other half of the answer.

## 3. One result cannot eat the window / 一次结果吃满上下文

```json
{ "tool": "files", "arguments": { "action": "read", "path": "D:\\logs\\app.log" } }
```

A 4 MB log file comes back as:

```text
2026-10-21 09:14:02 INFO  starting
...
... (3976142 characters trimmed; use a narrower call if you need the middle) ...
2026-10-21 09:20:11 ERROR could not reach the license server
```

The head *and* the tail are kept — the beginning usually says what the file is, and the
end is usually what the user asked about — and the note names the exact fix: read less
(`read` with `offset`/`limit`), or search instead of reading (`grep`).

The same cap applies while PowerShell output is being read: a stream is kept at ~1 MB
(600 KB head + 400 KB tail), so `Get-Content` on a 2 GB file cannot take the agent
process down with it:

```text
... (1843120 characters dropped: the output was larger than 1000000) ...
```

## 4. An error the model can act on / 能照着做的报错

Windows errors are English (the prologue pins the UI culture; see
`psEnglishErrors`), and each class of failure gets one sentence in the interface
language that says what to do next:

| The PowerShell text says | The hint adds |
| --- | --- |
| `Access to the path 'C:\Program Files\…' is denied.` | this needs administrator rights and win-agent is NOT elevated - restart win-agent from an elevated PowerShell, or ask the user to do it |
| `ParserError … Unexpected token '}'` | the script itself has a syntax error - fix the quotes/brackets before running it again |
| `The term 'Get-Thing' is not recognized as the name of a cmdlet` | that command does not exist on this machine - check the spelling, or use the structured tool instead |
| `The process cannot access the file … because it is being used by another process` | the file is open in another program - close it (or ask the user to) and try again |
| `Cannot bind argument to parameter 'Path' because it is null` | a parameter name or type is wrong - check the cmdlet's parameters |
| `Cannot find any service with service name 'x'` | use the short service name, e.g. Spooler - "services list" shows the names |
| `The remote name could not be resolved` | the name or the network path could not be resolved - check the spelling and whether the machine is reachable |
| `the command did not finish within 60000 ms and was killed` | the command was killed because it ran too long - do less per call, or split it into steps |

In Chinese the hint is Chinese:

```text
Copy-Item : The process cannot access the file 'x' because it is being used by another process.
(这个文件正被别的程序占用——先关掉它（或请用户关掉），再重试)
```

The refusal prefixes are part of the same story, and worth keeping apart when you read a
log:

| Prefix | Means | The model should |
| --- | --- | --- |
| `Error:` | the call was made and failed | fix the arguments, try again once |
| `Refused:` | the sandbox stopped it before anything happened | change the path, or ask for the sandbox to be switched off |
| `Blocked:` | the loop guard stopped a repeat | change the approach or answer |
| `Cancelled by user.` | an approval prompt was declined | ask, or stop |
| `DRY RUN:` | nothing was done on purpose (`dryRun`) | — |
