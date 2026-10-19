// The sandbox: every file path a tool is handed has to stay inside the working
// directory, and the two scripting tools are withheld while it is on.
// Run with: npm run test:sandbox
//
// What it locks down:
//   - a path inside the working directory is allowed, one outside is refused
//   - `..`, absolute paths elsewhere and a junction pointing out are all refused
//   - the refusal names the path, the fence and the three ways out
//   - a refused write changes nothing on disk
//   - powershell and custom are withheld while the sandbox is on, and calling one
//     says why instead of "unknown tool"
//   - switched off, the same calls go through again
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jailPath, isInside, SandboxRefusal, sandboxEnabled } from "../src/sandbox.js";
import { updateSettings } from "../src/settings.js";
import { createWindowsTools } from "../src/tools/index.js";

const scratch = path.join(os.tmpdir(), `win-agent-sandbox-${process.pid}`);
process.env.AGENT_DATA_DIR = path.join(scratch, "data");
const inside = path.join(scratch, "inside");
const outside = path.join(scratch, "outside");
fs.mkdirSync(inside, { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(outside, "secret.txt"), "outside-the-fence");

let passed = 0;
let failures = 0;
function check(label, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}
function section(name) {
  console.log(`\n${name}`);
}

/** The refusal `jailPath` raises, or null when it lets the path through. */
function refusal(value) {
  try {
    jailPath(value);
    return null;
  } catch (error) {
    return error;
  }
}

const tools = createWindowsTools(async () => true, { dryRun: false });
const call = (name, args) => tools.execute(name, JSON.stringify(args));

try {
  // The suite works in its own folder: relative paths resolve against it, and it is
  // the fence the agent is confined to.
  process.chdir(inside);
  updateSettings({ workdir: inside, sandbox: true });

  /* ---------------------------------------------------------------------- */
  /* The fence                                                              */
  /* ---------------------------------------------------------------------- */

  section("the fence");
  {
    check("it is on out of the box", sandboxEnabled());
    check("the working directory itself is allowed", jailPath(".") === inside);
    check("a relative path inside is allowed", jailPath("note.txt") === path.join(inside, "note.txt"));
    check("a nested path inside is allowed", jailPath("sub\\deep\\x.txt") === path.join(inside, "sub", "deep", "x.txt"));
    check("an absolute path inside is allowed", jailPath(path.join(inside, "sub", "x.txt")) === path.join(inside, "sub", "x.txt"));

    const up = refusal("..\\outside\\secret.txt");
    check("`..` out of the folder is refused", up instanceof SandboxRefusal, String(up));
    check("a path one level up is refused", refusal("..") instanceof SandboxRefusal);
    check(
      "an absolute path elsewhere is refused",
      refusal(path.join(outside, "secret.txt")) instanceof SandboxRefusal,
    );
    check(
      "a sibling folder is refused",
      refusal(path.join(scratch, "inside-sibling")) instanceof SandboxRefusal,
    );
  }

  section("what the refusal says");
  {
    const error = refusal(path.join(outside, "secret.txt"));
    const message = String(error?.message ?? "");
    check("it names the path", message.includes(path.join(outside, "secret.txt")), message);
    check("it names the fence", message.includes(`outside the sandbox (${inside})`), message);
    check("it says nothing was touched", /nothing was touched/.test(message), message);
    check("it offers the way out", /switch the sandbox off in Settings/.test(message), message);
  }

  section("a junction is not a way out");
  {
    const door = path.join(inside, "door");
    let linked = true;
    try {
      fs.symlinkSync(outside, door, process.platform === "win32" ? "junction" : "dir");
    } catch {
      linked = false; // e.g. a filesystem that does not do links
    }
    if (!linked) {
      check("the platform can create a link (skipped)", true);
    } else {
      check("the link really reaches outside", fs.existsSync(path.join(door, "secret.txt")));
      check("but the sandbox follows it and refuses", refusal("door\\secret.txt") instanceof SandboxRefusal);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* The tools                                                              */
  /* ---------------------------------------------------------------------- */

  section("a refused write changes nothing");
  {
    const result = await call("files", { action: "write", path: "..\\outside\\evil.txt", content: "x" });
    check("it comes back as a refusal, not a crash", result.startsWith("Refused: "), result);
    check("the file was not created", !fs.existsSync(path.join(outside, "evil.txt")));
  }

  section("inside the fence the files tool works");
  {
    const wrote = await call("files", { action: "write", path: "hello.txt", content: "hello" });
    check("the write happened", /Wrote 5 characters/.test(wrote), wrote);
    const read = await call("files", { action: "read", path: "hello.txt" });
    check("the read comes back", read === "hello", read);
    const listed = await call("files", { action: "list", path: "." });
    check("the listing sees it", /hello\.txt/.test(listed), listed);
  }

  section("the scripting tools are withheld");
  {
    check("powershell is not offered", !tools.names().includes("powershell"));
    const shell = await call("powershell", { script: "Get-Date" });
    check("calling it explains why", /the sandbox is on, so scripts are not run/.test(shell), shell);
    check("it is not reported as unknown", !/unknown tool/.test(shell), shell);
    check("it points at the structured tools", /files, system, services/.test(shell), shell);

    // `custom` only exists when the user defined commands; the sandbox has to
    // withhold it after it is registered, which is the easy one to get wrong.
    const withCustom = createWindowsTools(async () => true, {
      customTools: [{ name: "hello", description: "say hello", script: "Write-Output hi" }],
    });
    check("custom is not offered either", !withCustom.names().includes("custom"));
    const custom = await withCustom.execute("custom", JSON.stringify({ action: "hello" }));
    check("calling it explains why too", /the sandbox is on/.test(custom), custom);

    // Guided mode already withholds the shell, with its own reason and its own way
    // out; the sandbox must not overwrite that with "switch the sandbox off".
    const guided = createWindowsTools(async () => true, { agentMode: "guided" });
    const guidedShell = await guided.execute("powershell", JSON.stringify({ script: "Get-Date" }));
    check(
      "guided mode keeps its own reason",
      /guided mode/.test(guidedShell) && !/the sandbox is on/.test(guidedShell),
      guidedShell,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Switched off                                                           */
  /* ---------------------------------------------------------------------- */

  section("switched off, the same calls go through");
  {
    updateSettings({ sandbox: false });
    check("the switch reaches the policy", !sandboxEnabled());
    check("the same outside path is allowed", jailPath(path.join(outside, "secret.txt")) === path.join(outside, "secret.txt"));
    const read = await call("files", { action: "read", path: path.join(outside, "secret.txt") });
    check("and it reads the file", read === "outside-the-fence", read);

    const unlocked = createWindowsTools(async () => true, {
      customTools: [{ name: "hello", description: "say hello", script: "Write-Output hi" }],
    });
    check("powershell is offered again", unlocked.names().includes("powershell"));
    check("custom is offered again", unlocked.names().includes("custom"));

    updateSettings({ sandbox: true });
    check("and the fence is back", refusal(path.join(outside, "secret.txt")) instanceof SandboxRefusal);
  }

  section("isInside");
  {
    check("a child is inside", isInside(inside, path.join(inside, "a", "b")));
    check("the folder itself is inside", isInside(inside, inside));
    check("a sibling is not", !isInside(inside, outside));
    check("a prefix is not a parent", !isInside(path.join(scratch, "in"), path.join(scratch, "inside")));
    if (process.platform === "win32") {
      check("Windows paths compare case-insensitively", isInside(inside, path.join(inside, "SUB").toUpperCase()));
    }
  }
} finally {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // a leftover temp folder is harmless
  }
}

console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
