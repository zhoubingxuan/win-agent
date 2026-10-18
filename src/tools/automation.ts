import { arg, argEnum, argOpt, type Tool } from "./registry.js";
import { psQuote, runPs, runPsJson } from "../util/ps.js";

/* -------------------------------------------------------------------------- */
/* Scheduled tasks                                                            */
/* -------------------------------------------------------------------------- */

const TASK_ACTIONS = ["list", "info", "create", "delete", "run"] as const;
const TASK_SCHEDULES = ["ONCE", "DAILY", "HOURLY", "ONLOGON", "ONSTART"] as const;

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
        const time = argOpt(args, "time");
        if (!(await ctx.approve(`create scheduled task "${name}" running ${program}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would create task ${name}.`;

        const lines: string[] = [
          `$action = New-ScheduledTaskAction -Execute ${psQuote(program)}` +
            (extra ? ` -Argument ${psQuote(extra)}` : ""),
        ];
        if (schedule === "ONLOGON") {
          lines.push("$trigger = New-ScheduledTaskTrigger -AtLogOn");
        } else if (schedule === "ONSTART") {
          lines.push("$trigger = New-ScheduledTaskTrigger -AtStartup");
        } else {
          lines.push("$time = if ($t) { [datetime]$t } else { (Get-Date).AddMinutes(5) }");
          if (time) lines.push(`$t = ${psQuote(time)}`);
          lines.push(
            schedule === "HOURLY"
              ? "$trigger = New-ScheduledTaskTrigger -Once -At $time -RepetitionInterval (New-TimeSpan -Hours 1)"
              : `$trigger = New-ScheduledTaskTrigger -${schedule === "ONCE" ? "Once" : "Daily"} -At $time`,
          );
        }
        lines.push(
          `Register-ScheduledTask -TaskName ${psQuote(name)} -Action $action -Trigger $trigger -Force | Out-Null`,
        );
        await runPs(lines.join("; "));
        return `Scheduled task "${name}" created (${schedule}).`;
      }

      case "delete": {
        const name = arg(args, "name");
        if (!(await ctx.approve(`delete scheduled task "${name}"`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would delete task ${name}.`;
        await runPs(`Unregister-ScheduledTask -TaskName ${psQuote(name)} -Confirm:$false`);
        return `Scheduled task "${name}" deleted.`;
      }

      case "run": {
        const name = arg(args, "name");
        if (!(await ctx.approve(`run scheduled task "${name}" now`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would run task ${name}.`;
        await runPs(`Start-ScheduledTask -TaskName ${psQuote(name)}`);
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
        const data = await runPsJson(
          valueName
            ? `Get-ItemProperty -Path ${psQuote(keyPath)} -Name ${psQuote(valueName)} -ErrorAction Stop`
            : `Get-ItemProperty -Path ${psQuote(keyPath)} -ErrorAction Stop`,
        );
        return JSON.stringify(data, null, 2);
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
        await runPs(
          `New-ItemProperty -Path ${psQuote(keyPath)} -Name ${psQuote(valueName)} ` +
            `-Value ${psQuote(value)} -PropertyType ${type} -Force | Out-Null`,
        );
        return `Set ${keyPath}\\${valueName} (${type}).`;
      }

      case "delete": {
        const valueName = arg(args, "name");
        if (!(await ctx.approve(`delete registry value ${keyPath}\\${valueName}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would delete ${keyPath}\\${valueName}.`;
        await runPs(`Remove-ItemProperty -Path ${psQuote(keyPath)} -Name ${psQuote(valueName)}`);
        return `Deleted ${keyPath}\\${valueName}.`;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
