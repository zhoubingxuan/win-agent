import { arg, argEnum, argOpt, type Tool } from "./registry.js";
import { psQuote, runPs, runPsJson } from "../util/ps.js";

/* -------------------------------------------------------------------------- */
/* Scheduled tasks                                                            */
/* -------------------------------------------------------------------------- */

const TASK_ACTIONS = ["list", "info", "create", "delete", "run"] as const;
const TASK_SCHEDULES = ["ONCE", "DAILY", "HOURLY", "ONLOGON", "ONSTART"] as const;

export interface TaskPlan {
  name: string;
  program: string;
  args: string;
  schedule: (typeof TASK_SCHEDULES)[number];
  /** "HH:mm" or any string PowerShell can read as a date-time. */
  time: string;
}

/**
 * Build the script that registers a scheduled task.
 *
 * This is a separate function so the *order* of the statements can be tested
 * without touching the machine: the start time has to be parsed before the
 * trigger that uses it, and the old code computed `$time` from `$t` one line
 * before `$t` was set, so `time` was silently ignored and every task started
 * five minutes from now.
 *
 * `-At` also accepts a bare "23:30"; the parse below is deliberately tolerant
 * because the string comes from a model, and a locale-dependent `[datetime]`
 * cast would throw on half of them.
 */
export function buildTaskScript(plan: TaskPlan): { script: string; when: string } {
  const lines: string[] = [
    `$gwAction = New-ScheduledTaskAction -Execute ${psQuote(plan.program)}` +
      (plan.args ? ` -Argument ${psQuote(plan.args)}` : ""),
  ];

  let when: string;
  if (plan.schedule === "ONLOGON") {
    lines.push("$gwTrigger = New-ScheduledTaskTrigger -AtLogOn");
    when = "at logon";
  } else if (plan.schedule === "ONSTART") {
    lines.push("$gwTrigger = New-ScheduledTaskTrigger -AtStartup");
    when = "at startup";
  } else {
    lines.push("$gwStart = (Get-Date).AddMinutes(5)");
    if (plan.time) {
      lines.push(
        `$gwRaw = ${psQuote(plan.time)}; ` +
          `$gwOk = [datetime]::TryParse($gwRaw, [System.Globalization.CultureInfo]::InvariantCulture, ` +
          "[System.Globalization.DateTimeStyles]::None, [ref]$gwStart); " +
          "if (-not $gwOk) { $gwOk = [datetime]::TryParse($gwRaw, [ref]$gwStart) }",
      );
      when = `${plan.schedule.toLowerCase()} starting ${plan.time}`;
    } else {
      when = `${plan.schedule.toLowerCase()} starting in 5 minutes`;
    }
    lines.push(
      plan.schedule === "HOURLY"
        ? "$gwTrigger = New-ScheduledTaskTrigger -Once -At $gwStart -RepetitionInterval (New-TimeSpan -Hours 1)"
        : `$gwTrigger = New-ScheduledTaskTrigger -${plan.schedule === "ONCE" ? "Once" : "Daily"} -At $gwStart`,
    );
  }

  lines.push(
    // -Force makes re-creating an existing task idempotent instead of an error.
    `Register-ScheduledTask -TaskName ${psQuote(plan.name)} -Action $gwAction -Trigger $gwTrigger -Force | Out-Null`,
  );
  return { script: lines.join("; "), when };
}

/** Is there already a task with this name (so creating one would overwrite it)? */
async function scheduledTaskExists(name: string): Promise<boolean> {
  try {
    const data = await runPsJson<{ exists: boolean }>(
      `[pscustomobject]@{ exists = [bool](Get-ScheduledTask -TaskName ${psQuote(name)} -ErrorAction SilentlyContinue) }`,
    );
    return data?.exists === true;
  } catch {
    return true; // unknown: assume there is something to lose, so nothing is promised
  }
}

export const scheduledTasksTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "scheduled_tasks",
      description:
        "Manage Windows Task Scheduler entries without schtasks syntax. " +
        "actions: list, info, create, delete, run. " +
        "For create, give a name, the program path, and a schedule.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...TASK_ACTIONS] },
          name: { type: "string", description: "Task name." },
          program: { type: "string", description: "Program or script to run." },
          args: { type: "string", description: "Arguments for the program." },
          schedule: { type: "string", enum: [...TASK_SCHEDULES] },
          time: { type: "string", description: "Start time HH:mm for DAILY/ONCE." },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = argEnum(args, "action", TASK_ACTIONS);

    switch (action) {
      case "list": {
        const data = await runPsJson(
          "Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\\Microsoft*' } | " +
            "Select-Object TaskName,TaskPath,@{n='State';e={$_.State.ToString()}} | " +
            "Sort-Object TaskPath,TaskName",
        );
        return data ? JSON.stringify(data, null, 2) : "No user scheduled tasks.";
      }

      case "info": {
        const name = arg(args, "name");
        const data = await runPsJson(
          `Get-ScheduledTask -TaskName ${psQuote(name)} -ErrorAction Stop | ` +
            "Select-Object TaskName,@{n='State';e={$_.State.ToString()}}," +
            "@{n='Action';e={$_.Actions.Execute}}," +
            "@{n='Args';e={$_.Actions.Arguments}}",
        );
        return JSON.stringify(data, null, 2);
      }

      case "create": {
        const name = arg(args, "name");
        const program = arg(args, "program");
        const extra = argOpt(args, "args") ?? "";
        const schedule = argEnum(args, "schedule", TASK_SCHEDULES);
        const time = argOpt(args, "time") ?? "";
        if (!(await ctx.approve(`create scheduled task "${name}" running ${program}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would create task ${name}.`;

        // Register-ScheduledTask -Force overwrites a task of the same name, so ask
        // first whether there is one to lose: only a genuinely new task is
        // undoable (Undo button = "remove the task I just made").
        const existed = await scheduledTaskExists(name);
        const { script, when } = buildTaskScript({ name, program, args: extra, schedule, time });
        await runPs(script);
        ctx.record({
          action: "create",
          summary: `created scheduled task "${name}" (${when})`,
          steps: existed
            ? []
            : [
                {
                  kind: "script",
                  label: `delete task ${name}`,
                  script: `Unregister-ScheduledTask -TaskName ${psQuote(name)} -Confirm:$false`,
                },
              ],
        });

        // Say what actually happens next, instead of only claiming success: the
        // next run time is computed by Task Scheduler, not by us.
        let next = "";
        try {
          const info = await runPsJson<{ State?: string; NextRunTime?: string }>(
            `Get-ScheduledTask -TaskName ${psQuote(name)} -ErrorAction Stop | ` +
              "Select-Object @{n='State';e={$_.State.ToString()}}," +
              "@{n='NextRunTime';e={($_ | Get-ScheduledTaskInfo).NextRunTime}}",
          );
          if (info?.NextRunTime) next = ` Next run: ${info.NextRunTime}`;
        } catch {
          // The task exists either way; a missing "next run" is not a failure.
        }
        return `Scheduled task "${name}" created (${when}).${next}`;
      }

      case "delete": {
        const name = arg(args, "name");
        if (!(await ctx.approve(`delete scheduled task "${name}"`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would delete task ${name}.`;
        // Export the task definition first: this is the only way to put it back
        // exactly as it was (triggers, principal, settings and all).
        let xml: string | null = null;
        try {
          xml = await runPs(`Export-ScheduledTask -TaskName ${psQuote(name)}`);
        } catch {
          xml = null;
        }
        if (!xml) return `Refused: could not read task "${name}", so the delete could not be undone.`;
        await runPs(`Unregister-ScheduledTask -TaskName ${psQuote(name)} -Confirm:$false`);
        ctx.record({
          action: "delete",
          summary: `deleted scheduled task "${name}"`,
          steps: [
            {
              kind: "script",
              label: `restore task ${name}`,
              script:
                `Register-ScheduledTask -TaskName ${psQuote(name)} -Xml ${psQuote(xml)} ` +
                "-Force | Out-Null",
            },
          ],
        });
        return `Scheduled task "${name}" deleted.`;
      }

      case "run": {
        const name = arg(args, "name");
        if (!(await ctx.approve(`run scheduled task "${name}" now`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would run task ${name}.`;
        await runPs(`Start-ScheduledTask -TaskName ${psQuote(name)}`);
        ctx.record({
          action: "run",
          summary: `started scheduled task "${name}"`,
        });
        return `Scheduled task "${name}" started.`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

const REG_ACTIONS = ["get", "list", "set", "delete"] as const;
const REG_TYPES = ["String", "ExpandString", "DWord", "QWord", "MultiString"] as const;

/** What a value looked like before it was touched (see readRegValue). */
interface SavedRegValue {
  kind: (typeof REG_TYPES)[number];
  value: unknown;
}

/**
 * Read one value exactly as the registry stores it - including its kind - so a
 * later change can be reversed. `RegistryValueOptions::DoNotExpandEnvironmentNames`
 * matters: without it a REG_EXPAND_SZ value comes back expanded and would be
 * written back with the user's environment baked into it.
 *
 * Returns null when the key, the value or the kind cannot be reproduced.
 */
async function readRegValue(keyPath: string, valueName: string): Promise<SavedRegValue | null> {
  const data = await runPsJson<{ found: boolean; kind: string | null; value: unknown }>(
    `$wgKey = Get-Item -Path ${psQuote(keyPath)} -ErrorAction SilentlyContinue; ` +
      "$wgFound = $false; $wgKind = $null; $wgValue = $null; " +
      "if ($wgKey -ne $null -and $wgKey.GetValueNames() -contains " +
      `${psQuote(valueName)}) { $wgFound = $true; ` +
      `$wgKind = $wgKey.GetValueKind(${psQuote(valueName)}).ToString(); ` +
      `$wgValue = $wgKey.GetValue(${psQuote(valueName)}, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }; ` +
      "[pscustomobject]@{ found = $wgFound; kind = $wgKind; value = $wgValue }",
  );
  if (!data?.found) return null;
  const kind = REG_TYPES.find((type) => type === data.kind);
  if (!kind) return null; // Binary and the rest cannot be written back painlessly
  return { kind, value: data.value };
}

/** A PowerShell literal that writes `value` back as the registry type `kind`. */
function regLiteral(saved: SavedRegValue): string {
  const text = saved.value === null || saved.value === undefined ? "" : String(saved.value);
  if (saved.kind === "DWord" || saved.kind === "QWord") {
    const number = Number(text);
    return Number.isFinite(number) ? String(Math.trunc(number)) : "0";
  }
  if (saved.kind === "MultiString") {
    const list = Array.isArray(saved.value) ? saved.value.map((item) => String(item)) : [text];
    return `@(${list.map((item) => psQuote(item)).join(", ")})`;
  }
  return psQuote(text);
}

/** The step that puts a saved registry value back. */
function restoreRegStep(keyPath: string, valueName: string, saved: SavedRegValue) {
  return {
    kind: "script" as const,
    label: `restore ${keyPath}\\${valueName}`,
    script:
      `New-ItemProperty -Path ${psQuote(keyPath)} -Name ${psQuote(valueName)} ` +
      `-Value ${regLiteral(saved)} -PropertyType ${saved.kind} -Force | Out-Null`,
  };
}

/** The step that removes a registry value the agent created. */
function removeRegStep(keyPath: string, valueName: string) {
  return {
    kind: "script" as const,
    label: `delete ${keyPath}\\${valueName}`,
    script:
      `Remove-ItemProperty -Path ${psQuote(keyPath)} -Name ${psQuote(valueName)} ` +
      "-ErrorAction SilentlyContinue",
  };
}

export const registryTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "registry",
      description:
        "Read or modify the Windows registry. actions: get (values of a key), list (subkeys), " +
        "set (create/overwrite a value), delete (remove a value). " +
        "Paths look like 'HKCU:\\Software\\MyApp' or 'HKLM:\\SOFTWARE\\Microsoft\\Windows'.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...REG_ACTIONS] },
          path: { type: "string", description: "Registry key path (with HKLM:/HKCU:)." },
          name: { type: "string", description: "Value name for get/set/delete." },
          value: { type: "string", description: "Value data for set." },
          type: { type: "string", enum: [...REG_TYPES] },
        },
        required: ["action", "path"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = argEnum(args, "action", REG_ACTIONS);
    const keyPath = arg(args, "path");

    switch (action) {
      case "get": {
        const valueName = argOpt(args, "name");
        // Two PowerShell traps in one place:
        //  - Get-ItemProperty also returns PSPath/PSParentPath/PSChildName/PSDrive/
        //    PSProvider, and PSProvider drags in the whole provider + module object
        //    graph, so ConvertTo-Json walks all of it and dies with
        //    System.OutOfMemoryException.
        //  - Asking for a value (or a key) that is not there is a non-terminating
        //    error, which makes powershell.exe exit 1 and buries the real answer in a
        //    CLIXML blob.
        // So: ask Test-Path first, read the values once, and let the caller (here) pick
        // the one value it wanted.
        const valuesOnly =
          "Select-Object * -ExcludeProperty PSPath,PSParentPath,PSChildName,PSDrive,PSProvider";
        const data = await runPsJson<{ exists: boolean; values: Record<string, unknown> | null }>(
          `$wgKey = ${psQuote(keyPath)}; ` +
            // Has to end with an expression: runPsJson appends "| ConvertTo-Json" to
            // whatever it is given, and that cannot attach to an if/else block.
            `$wgExists = Test-Path -Path $wgKey; ` +
            `$wgValues = if ($wgExists) { Get-ItemProperty -Path $wgKey | ${valuesOnly} } else { $null }; ` +
            `[pscustomobject]@{ exists = $wgExists; values = $wgValues }`,
        );
        if (!data || !data.exists) return `Registry key ${keyPath} does not exist.`;

        const values = data.values ?? {};
        const names = Object.keys(values);
        if (valueName) {
          if (!names.includes(valueName)) {
            return names.length === 0
              ? `Registry value "${valueName}" does not exist: ${keyPath} has no values.`
              : `Registry value "${valueName}" does not exist in ${keyPath}. Available: ${names.join(", ")}`;
          }
          return JSON.stringify({ [valueName]: values[valueName] }, null, 2);
        }
        return names.length === 0 ? `(no values in ${keyPath})` : JSON.stringify(values, null, 2);
      }

      case "list": {
        const data = await runPsJson(
          `Get-ChildItem -Path ${psQuote(keyPath)} -ErrorAction Stop | Select-Object -ExpandProperty PSChildName`,
        );
        return data ? JSON.stringify(data, null, 2) : "(no subkeys)";
      }

      case "set": {
        const valueName = arg(args, "name");
        const value = argOpt(args, "value") ?? "";
        const type = argEnum(args, "type", REG_TYPES);
        if (!(await ctx.approve(`set registry value ${keyPath}\\${valueName}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would set ${keyPath}\\${valueName}.`;
        const saved = await readRegValue(keyPath, valueName);
        await runPs(
          `New-ItemProperty -Path ${psQuote(keyPath)} -Name ${psQuote(valueName)} ` +
            `-Value ${psQuote(value)} -PropertyType ${type} -Force | Out-Null`,
        );
        ctx.record({
          action: "set",
          summary: `set ${keyPath}\\${valueName} (${type})`,
          steps: [saved ? restoreRegStep(keyPath, valueName, saved) : removeRegStep(keyPath, valueName)],
        });
        return `Set ${keyPath}\\${valueName} (${type}).`;
      }

      case "delete": {
        const valueName = arg(args, "name");
        if (!(await ctx.approve(`delete registry value ${keyPath}\\${valueName}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would delete ${keyPath}\\${valueName}.`;
        const saved = await readRegValue(keyPath, valueName);
        await runPs(`Remove-ItemProperty -Path ${psQuote(keyPath)} -Name ${psQuote(valueName)}`);
        ctx.record({
          action: "delete",
          summary: `deleted ${keyPath}\\${valueName}`,
          paths: [],
          steps: saved ? [restoreRegStep(keyPath, valueName, saved)] : [],
        });
        return `Deleted ${keyPath}\\${valueName}.${saved ? "" : " (not undoable: the old value could not be read)"}`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
