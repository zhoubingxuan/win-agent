import { arg, argEnum, argNum, type Tool } from "./registry.js";
import { psQuote, runPs, runPsJson } from "../util/ps.js";

const ACTIONS = [
  "ipconfig",
  "ping",
  "dns_lookup",
  "port_check",
  "connections",
  "firewall_list",
  "firewall_add",
  "firewall_remove",
  "wifi_profiles",
] as const;

/*
 * Two cmdlet families used here were renamed or moved between Windows PowerShell
 * 5.1 and PowerShell 7, and the agent lets the user pick either binary:
 *
 * - `Test-Connection -ComputerName` (5.1) became `-TargetName` (7+), so neither
 *   spelling works on both. Pinging through the .NET `Ping` class works on both,
 *   is much faster, and reports packet loss in a shape a model can use.
 * - `Test-NetConnection` prints a formatted table and takes seconds to give up;
 *   a `TcpClient` connect with an explicit timeout answers the actual question
 *   ("is this port open?") in milliseconds.
 * - The `NetTCPIP` cmdlets (`Get-NetTCPConnection`, `Get-NetIPConfiguration`) do
 *   not exist on Windows 7/8/Server 2012, so `connections` and `ipconfig` fall
 *   back to `netstat` / WMI there.
 */

export const networkTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "network",
      description:
        "Network diagnostics, firewall rules and Wi-Fi profiles. " +
        "actions: ipconfig, ping, dns_lookup, port_check, connections (listening ports), " +
        "firewall_list, firewall_add, firewall_remove, wifi_profiles.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...ACTIONS] },
          host: { type: "string", description: "Host name or IP for ping/dns_lookup/port_check." },
          port: { type: "number", description: "Port for port_check or firewall rules." },
          count: { type: "number", description: "How many pings to send. Default 4." },
          timeout: { type: "number", description: "Milliseconds to wait per ping/port check. Default 2000." },
          rule: { type: "string", description: "Firewall rule display name." },
          protocol: { type: "string", enum: ["TCP", "UDP"] },
          direction: { type: "string", enum: ["Inbound", "Outbound"] },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },

  async run(args, ctx) {
    const action = argEnum(args, "action", ACTIONS);

    switch (action) {
      case "ipconfig": {
        // runPsJson appends "| ConvertTo-Json" to the whole script, so the script
        // has to *end with an expression*: an if/else block cannot be piped from,
        // hence the variable.
        const data = await runPsJson(
          [
            "$gwConfig = if (Get-Command Get-NetIPConfiguration -ErrorAction SilentlyContinue) {",
            "  Get-NetIPConfiguration | ForEach-Object {",
            "    [pscustomobject]@{",
            "      Interface = $_.InterfaceAlias",
            "      IPv4 = ($_.IPv4Address.IPAddress -join ', ')",
            "      Gateway = ($_.IPv4DefaultGateway.NextHop -join ', ')",
            "      DNS = (($_.DNSServer | Where-Object AddressFamily -eq 2).ServerAddresses -join ', ')",
            "    }",
            "  }",
            "} else {",
            "  Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' | ForEach-Object {",
            "    [pscustomobject]@{",
            "      Interface = $_.Description",
            "      IPv4 = ($_.IPAddress -join ', ')",
            "      Gateway = ($_.DefaultIPGateway -join ', ')",
            "      DNS = ($_.DNSServerSearchOrder -join ', ')",
            "    }",
            "  }",
            "}",
            "$gwConfig",
          ].join("\n"),
        );
        return data ? JSON.stringify(data, null, 2) : "No IP configuration found.";
      }

      case "ping": {
        const host = arg(args, "host");
        const count = Math.max(1, Math.min(argNum(args, "count", 4), 20));
        const timeout = Math.max(100, argNum(args, "timeout", 2_000));
        const data = await runPsJson(
          [
            "$gwPing = New-Object System.Net.NetworkInformation.Ping;",
            "$gwSent = 0; $gwOk = 0; $gwTimes = @(); $gwAddress = $null; $gwError = '';",
            `for ($gwI = 1; $gwI -le ${count}; $gwI++) {`,
            `  try { $gwReply = $gwPing.Send(${psQuote(host)}, ${timeout}) } catch { $gwReply = $null; $gwError = $_.Exception.Message }`,
            "  $gwSent++",
            "  if ($gwReply -and $gwReply.Status -eq 'Success') {",
            "    $gwOk++",
            "    $gwTimes += $gwReply.RoundtripTime",
            "    $gwAddress = $gwReply.Address.IPAddressToString",
            "  } elseif (-not $gwError -and $gwReply) { $gwError = $gwReply.Status.ToString() }",
            "}",
            "$gwStats = if ($gwTimes.Count -gt 0) { $gwTimes | Measure-Object -Minimum -Maximum -Average } else { $null }",
            "[pscustomobject]@{",
            `  Host = ${psQuote(host)}`,
            "  Address = $gwAddress",
            "  Sent = $gwSent",
            "  Received = $gwOk",
            "  Lost = $gwSent - $gwOk",
            "  MinMs = if ($gwStats) { [int]$gwStats.Minimum } else { $null }",
            "  MaxMs = if ($gwStats) { [int]$gwStats.Maximum } else { $null }",
            "  AvgMs = if ($gwStats) { [math]::Round($gwStats.Average, 1) } else { $null }",
            "  Error = $gwError",
            "}",
          ].join("\n"),
        );
        return JSON.stringify(data, null, 2);
      }

      case "dns_lookup": {
        const host = arg(args, "host");
        const data = await runPsJson(
          `Resolve-DnsName -Name ${psQuote(host)} -ErrorAction Stop | ` +
            "Select-Object Name,Type,IPAddress,NameHost",
        );
        return JSON.stringify(data, null, 2);
      }

      case "port_check": {
        const host = arg(args, "host");
        const port = argNum(args, "port", 0);
        const timeout = Math.max(100, argNum(args, "timeout", 3_000));
        if (port <= 0) throw new Error("a valid 'port' is required for port_check");
        const data = await runPsJson(
          [
            "$gwAddress = $null;",
            `try { $gwAddress = ([System.Net.Dns]::GetHostAddresses(${psQuote(host)}) | Select-Object -First 1).IPAddressToString } catch { $gwAddress = $null }`,
            "$gwClient = New-Object System.Net.Sockets.TcpClient; $gwOpen = $false; $gwNote = ''",
            "try {",
            `  $gwAsync = $gwClient.BeginConnect(${psQuote(host)}, ${port}, $null, $null)`,
            `  if ($gwAsync.AsyncWaitHandle.WaitOne(${timeout}, $false)) {`,
            "    try { $gwClient.EndConnect($gwAsync); $gwOpen = $true } catch { $gwOpen = $false; $gwNote = $_.Exception.InnerException.Message }",
            "  } else { $gwNote = 'timed out' }",
            "} catch { $gwNote = $_.Exception.Message }",
            "finally { $gwClient.Close() }",
            "[pscustomobject]@{",
            `  Host = ${psQuote(host)}`,
            "  Address = $gwAddress",
            `  Port = ${port}`,
            "  Open = $gwOpen",
            "  Result = if ($gwOpen) { 'OPEN' } else { 'CLOSED or FILTERED' }",
            "  Note = $gwNote",
            "}",
          ].join("\n"),
          { timeoutMs: timeout + 15_000 },
        );
        const open = (data as { Open?: boolean } | null)?.Open === true;
        return `${open ? "OPEN" : "CLOSED/FILTERED"}: ${host}:${port}\n${JSON.stringify(data, null, 2)}`;
      }

      case "connections": {
        const data = await runPsJson(
          [
            "$gwConns = if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {",
            "  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |",
            "    Select-Object LocalAddress,LocalPort," +
              "@{n='Process';e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}," +
              "@{n='PID';e={$_.OwningProcess}}",
            "} else {",
            // Windows 7/8: no NetTCPIP module. netstat is everywhere.
            "  netstat -ano | Where-Object { $_ -match '^\\s*TCP\\s+\\S+:\\d+\\s+\\S+\\s+LISTENING\\s+\\d+' } | ForEach-Object {",
            "    $gwM = [regex]::Match($_, '^\\s*TCP\\s+(\\S+):(\\d+)\\s+\\S+\\s+LISTENING\\s+(\\d+)')",
            "    $gwPid = [int]$gwM.Groups[3].Value",
            "    [pscustomobject]@{",
            "      LocalAddress = $gwM.Groups[1].Value",
            "      LocalPort = [int]$gwM.Groups[2].Value",
            "      Process = (Get-Process -Id $gwPid -ErrorAction SilentlyContinue).ProcessName",
            "      PID = $gwPid",
            "    }",
            "  }",
            "}",
            "$gwConns | Sort-Object LocalPort",
          ].join("\n"),
          { timeoutMs: 120_000 },
        );
        return JSON.stringify(data, null, 2);
      }

      case "firewall_list": {
        const data = await runPsJson(
          "Get-NetFirewallRule -Enabled True -ErrorAction SilentlyContinue | " +
            "Where-Object Direction -eq Inbound | " +
            "Select-Object -First 100 DisplayName,Direction," +
            "@{n='Action';e={$_.Action.ToString()}},@{n='Profile';e={$_.Profile.ToString()}}",
          { timeoutMs: 120_000 },
        );
        return JSON.stringify(data, null, 2);
      }

      case "firewall_add": {
        const rule = arg(args, "rule");
        const port = argNum(args, "port", 0);
        const protocol = argEnum(args, "protocol", ["TCP", "UDP"] as const);
        const direction = argEnum(args, "direction", ["Inbound", "Outbound"] as const);
        const portPart = port > 0 ? ` -LocalPort ${port} -Protocol ${protocol}` : "";
        if (!(await ctx.approve(`add firewall rule "${rule}" (${direction}${port > 0 ? ` port ${port}` : ""})`))) {
          return "Cancelled by user.";
        }
        if (ctx.dryRun) return `DRY RUN: would add firewall rule ${rule}.`;
        await runPs(
          `New-NetFirewallRule -DisplayName ${psQuote(rule)} -Direction ${direction} -Action Allow${portPart}`,
        );
        return `Firewall rule "${rule}" added.`;
      }

      case "firewall_remove": {
        const rule = arg(args, "rule");
        if (!(await ctx.approve(`remove firewall rule "${rule}"`))) return "Cancelled by user.";
        if (ctx.dryRun) return `DRY RUN: would remove firewall rule ${rule}.`;
        await runPs(`Remove-NetFirewallRule -DisplayName ${psQuote(rule)}`);
        return `Firewall rule "${rule}" removed.`;
      }

      case "wifi_profiles": {
        const out = await runPs("netsh wlan show profiles");
        return out;
      }

      default:
        throw new Error(`unhandled action ${action as string}`);
    }
  },
};
