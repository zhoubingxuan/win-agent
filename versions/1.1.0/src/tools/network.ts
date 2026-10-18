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
        const data = await runPsJson(
          [
            "Get-NetIPConfiguration | ForEach-Object {",
            "  [pscustomobject]@{",
            "    Interface = $_.InterfaceAlias",
            "    IPv4 = ($_.IPv4Address.IPAddress -join ', ')",
            "    Gateway = ($_.IPv4DefaultGateway.NextHop -join ', ')",
            "    DNS = (($_.DNSServer | Where-Object AddressFamily -eq 2).ServerAddresses -join ', ')",
            "  }",
            "}",
          ].join("\n"),
        );
        return data ? JSON.stringify(data, null, 2) : "No IP configuration found.";
      }

      case "ping": {
        const host = arg(args, "host");
        const count = argNum(args, "count", 4);
        const out = await runPs(
          `(Test-Connection -ComputerName ${psQuote(host)} -Count ${count} -ErrorAction Stop) | ` +
            "Select-Object Address,ResponseTime | Format-Table -AutoSize | Out-String",
        );
        return out || `${host} did not respond.`;
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
        if (port <= 0) throw new Error("a valid 'port' is required for port_check");
        const out = await runPs(
          `$r = Test-NetConnection -ComputerName ${psQuote(host)} -Port ${port} -WarningAction SilentlyContinue; ` +
            `if ($r.TcpTestSucceeded) { 'OPEN: ${host}:${port}' } else { 'CLOSED/UNREACHABLE: ${host}:${port}' }`,
          { timeoutMs: 120_000 },
        );
        return out;
      }

      case "connections": {
        const data = await runPsJson(
          "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | " +
            "Select-Object LocalAddress,LocalPort,@{n='Process';e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}} | " +
            "Sort-Object LocalPort",
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
