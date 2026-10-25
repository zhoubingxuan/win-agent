# A coder turn — patch, test, commit

A small Node project in `D:\new\demo`, one failing test, and a model that is not
allowed to write commands. The whole turn is structured tool calls.

```text
demo\
  package.json      { "scripts": { "test": "node test.js" } }
  sum.js            function sum(a, b) { return a - b; }
  test.js           asserts sum(2, 3) === 5
```

## 1. Look before touching anything

```json
{"action":"list","path":"D:\\new\\demo"}
{"action":"read","path":"D:\\new\\demo\\sum.js"}
```

```text
Contents of D:\new\demo: [file] 132 package.json [file] 46 sum.js [file] 161 test.js

function sum(a, b) {
  return a - b;
}

module.exports = { sum };
```

## 2. Ask what the tests are (optional, free)

```json
{"action":"detect","path":"D:\\new\\demo"}
```

```text
Detected npm test in D:\new\demo
  command: npm test --silent
  because: package.json has a "test" script
```

`detect` never runs anything. It is there so the model knows whether it can prove
the change before it makes it.

## 3. Preview the patch

```json
{"action":"preview","patch":"--- a/sum.js\n+++ b/sum.js\n@@ -1,3 +1,3 @@\n function sum(a, b) {\n-  return a - b;\n+  return a + b;\n }\n"}
```

```text
Preview only - nothing was written.
sum.js: 1 hunk(s), +1 -1
  -   return a - b;
  +   return a + b;
```

## 4. Apply it

Same call with `"action":"apply"` (or no `action`: apply is the default):

```text
Patched sum.js.
sum.js: 1 hunk(s), +1 -1
  -   return a - b;
  +   return a + b;
```

The file kept its encoding and line endings. A copy of the old bytes is in
`data/undo/`; `/undo` puts them back. The change is also in the audit log as
`patch`.

### When the patch does not match

```text
Error: hunk 1: the context does not match near line 1. Read the file again and
copy the exact lines (whitespace counts).
```

Nothing was written. If the context appears in two places:

```text
Error: hunk 1: the context appears 2 times (lines 3, 9); add a line that makes it unique.
```

A patch that touches several files is all-or-nothing: if the second file's hunk does
not match, the first file is not written either.

## 5. Run the project's tests

```json
{"action":"run","path":"D:\\new\\demo"}
```

The UI asks for approval first (tests execute project code).

```text
npm test in D:\new\demo: exit 0 in 1.2s (npm test --silent)
> test
> node test.js

1 passing
```

A failure is reported with its exit code and the output, clipped head+tail:

```text
npm test in D:\new\demo: exit 1 in 1.1s (npm test --silent)
...
AssertionError: sum(2, 3) returned -1
```

The model never chose `npm`, `pytest` or `cargo`: `tests` read the folder. That is
the difference between "the code looks right" and "the project says it works".

## 6. Commit (after asking)

```json
{"action":"status","path":"D:\\new\\demo"}
```

```text
## main
 M sum.js
```

```json
{"action":"diff","path":"D:\\new\\demo"}
```

```diff
-  return a - b;
+  return a + b;
```

```json
{"action":"commit","path":"D:\\new\\demo","message":"fix sum: add instead of subtract","files":["sum.js"]}
```

The approval card says:

```text
commit changes in demo: "fix sum: add instead of subtract"
```

```text
Committed 4a1c9e2 fix sum: add instead of subtract
 1 file changed, 1 insertion(+), 1 deletion(-)
```

`git` has no `push`, `reset`, `checkout` or `clean`. Publishing is your decision, and
undoing is `/undo`.

## 7. The overwrite guard

A model that decides to "create" a file that is already there gets:

```json
{"action":"write","path":"D:\\new\\demo\\sum.js","content":"function sum(a, b) { return a + b; }","overwrite":true}
```

```text
Refused: D:\new\demo\sum.js already has content. Read it first and pass expected with a piece
of the current text (at least 4 characters, or the whole text if it is shorter) if you really
mean to replace the whole file - or use action "edit" to change just the part that should change.
```

With proof:

```json
{"action":"write","path":"D:\\new\\demo\\sum.js","content":"...","overwrite":true,"expected":"return a - b;"}
```

```text
Wrote 72 characters to D:\new\demo\sum.js (replaced 46 characters; the old text began "function sum(a, b) {")
```

`apply_patch` or `edit` is still the better move: they show a diff and cannot silently
drop the rest of the file.

## 8. In guided mode

The same calls work, one per step. What does **not** work is writing `build.py` and
starting it:

```text
Error: guided mode does not run interpreters or scripts (python). Use the tests tool
for a project's tests; switch to normal or expert mode for the raw shell.
```

That refusal is the point of the mode. `processes start` accepts `cwd` for a normal
program (`{"action":"start","name":"notepad.exe","cwd":"D:\\new\\demo"}`), but an
interpreter waits until you switch to `normal` or `expert`.
