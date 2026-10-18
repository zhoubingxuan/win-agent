import { arg, argEnum, argOpt, type Tool } from "./registry.js";
import { psQuote, runPs, runPsJson } from "../util/ps.js";

const ACTIONS = [
  "info",
  "cpu",
  "memory",
  "disk",
  "uptime",
  "battery",
  "whoami",
  "env_get",
  "env_list",
  "env_set",
  "installed_apps",
  "lock_screen",
  "sleep",
  "shutdown",
  "restart",
  "hibernate",
] as const;

export const systemTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "system",
      description:
        "Read system information and control power state on this Windows machine. " +
        "actions: info, cpu, memory, disk, uptime, battery, whoami, env_get, env_list, env_set, " +
        "installed_apps, lock_screen, sleep, shutdown, restart, hibernate.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          name: { type: "string", description: "Environment variable name for env_get/env_set." },
          value: { type: "string", description: "Environment variable value for env_set." },
          scope: { type: "string", enum: ["User", "Machine"] },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = argEnum(args, "action", ACTIONS);

    switch (action) {
      case "info": {
        const data = await runPsJson<Record<string, unknown>>(
          [
            "$os = Get-CimInstance Win32_OperatingSystem",
            "$cs = Get-CimInstance Win32_ComputerSystem",
            "[pscustomobject]@{",
            "  ComputerName = $env:COMPUTERNAME",
            "  User = $env:USERNAME",
            "  OS = $os.Caption",
            "  Version = $os.Version",
            "  Architecture = $os.OSArchitecture",
            "  Manufacturer = $cs.Manufacturer",
            "  Model = $cs.Model",
            "  LastBoot = $os.LastBootUpTime",
            // Whether the agent is elevated decides whether services, the
            // firewall and machine-wide settings can be changed at all, so the
            // model can see it instead of guessing from an "access denied".
            "  IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
            "  PowerShell = '{0} ({1})' -f $PSVersionTable.PSVersion, $PSVersionTable.PSEdition",
            "  PowerShellExe = [System.Diagnostics.Process]::GetCurrentProcess().Path",
            "  TimeZone = (Get-TimeZone).Id",
            "  Now = (Get-Date).ToString('s')",
            "}",
          ].join("\n"),
        );
        return JSON.stringify(data, null, 2);
      }

      case "cpu": {
        const data = await runPsJson(
          "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,LoadPercentage",
        );
        return JSON.stringify(data, null, 2);
      }

      case "memory": {
        const data = await runPsJson(
          [
            "$os = Get-CimInstance Win32_OperatingSystem",
            "[pscustomobject]@{",
            "  TotalGB = [math]::Round($os.TotalVisibleMemorySize/1MB,2)",
            "  FreeGB  = [math]::Round($os.FreePhysicalMemory/1MB,2)",
            "  UsedPct = [math]::Round(100*(1-$os.FreePhysicalMemory/$os.TotalVisibleMemorySize),1)",
            "}",
          ].join("\n"),
        );
        return JSON.stringify(data, null, 2);
      }

      case "disk": {
        const data = await runPsJson(
          [
            "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {",
            "  [pscustomobject]@{",
            "    Drive = $_.DeviceID",
            "    SizeGB = [math]::Round($_.Size/1GB,2)",
            "    FreeGB = [math]::Round($_.FreeSpace/1GB,2)",
            "    FreePct = if ($_.Size) { [math]::Round(100*$_.FreeSpace/$_.Size,1) } else { 0 }",
            "  }",
            "}",
          ].join("\n"),
        );
        return JSON.stringify(data, null, 2);
      }

      case "uptime": {
        const out = await runPs(
          "$b=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime; " +
            "$s=(Get-Date)-$b; " +
            "'Uptime: {0}d {1}h {2}m (booted {3})' -f $s.Days,$s.Hours,$s.Minutes,$b",
        );
        return out;
      }

      case "battery": {
        const data = await runPsJson(
          "Get-CimInstance Win32_Battery | Select-Object Name,EstimatedChargeRemaining,BatteryStatus",
        );
        return data ? JSON.stringify(data, null, 2) : "No battery detected (desktop?).";
      }

      case "whoami": {
        return await runPs("whoami");
      }

      case "env_get": {
        const name = arg(args, "name");
        const scope = argEnum(args, "scope", ["User", "Machine"] as const);
        const value = await runPs(
          `[Environment]::GetEnvironmentVariable(${psQuote(name)}, ${psQuote(scope)})`,
        );
        return value === "" ? `${name} is not set (${scope}).` : `${name}=${value}`;
      }

      case "env_list": {
        const data = await runPsJson("Get-ChildItem Env: | Select-Object Name,Value");
        return JSON.stringify(data, null, 2);
      }

      case "env_set": {
        const name = arg(args, "name");
        const value = argOpt(args, "value") ?? "";
        const scope = argEnum(args, "scope", ["User", "Machine"] as const);
        if (!(await ctx.approve(`set ${scope} environment variable ${name}`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would set ${scope} ${name}=${value}`;
        await runPs(
          `[Environment]::SetEnvironmentVariable(${psQuote(name)}, ${psQuote(value)}, ${psQuote(scope)})`,
        );
        return `Set ${scope} environment variable ${name}.`;
      }

      case "installed_apps": {
        const data = await runPsJson(
          [
            "$paths = @(",
            "  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
            "  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
            "  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
            ")",
            "Get-ItemProperty $paths -ErrorAction SilentlyContinue |",
            "  Where-Object { $_.DisplayName } |",
            "  Select-Object DisplayName,DisplayVersion,Publisher |",
            "  Sort-Object DisplayName -Unique",
          ].join("\n"),
          { timeoutMs: 120_000 },
        );
        return JSON.stringify(data, null, 2);
      }

      case "lock_screen": {
        if (ctx.dryRun) return "DRY RUN: would lock the screen.";
        await runPs("rundll32.exe user32.dll,LockWorkStation");
        return "Screen locked.";
      }

      case "sleep": {
        if (!(await ctx.approve("put the computer to sleep"))) return "Cancelled by user.";
        if (ctx.dryRun) return "DRY RUN: would sleep.";
        await runPs("rundll32.exe powrprof.dll,SetSuspendState 0,1,0");
        return "Sleep requested.";
      }

      case "shutdown": {
        if (!(await ctx.approve("SHUT DOWN the computer"))) return "Cancelled by user.";
        if (ctx.dryRun) return "DRY RUN: would shut down.";
        await runPs("shutdown.exe /s /t 0");
        return "Shutdown requested.";
      }

      case "restart": {
        if (!(await ctx.approve("RESTART the computer"))) return "Cancelled by user.";
        if (ctx.dryRun) return "DRY RUN: would restart.";
        await runPs("shutdown.exe /r /t 0");
        return "Restart requested.";
      }

      case "hibernate": {
        if (!(await ctx.approve("hibernate the computer"))) return "Cancelled by user.";
        if (ctx.dryRun) return "DRY RUN: would hibernate.";
        await runPs("shutdown.exe /h");
        return "Hibernate requested.";
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
