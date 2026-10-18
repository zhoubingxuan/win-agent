import type { CustomTool } from "../settings.js";
import type { Approval } from "./registry.js";
import { ToolRegistry } from "./registry.js";
import { filesTool } from "./files.js";
import { systemTool } from "./system.js";
import { processesTool } from "./processes.js";
import { servicesTool } from "./services.js";
import { networkTool } from "./network.js";
import { scheduledTasksTool, registryTool } from "./automation.js";
import { uiTool } from "./ui.js";
import { powershellTool } from "./powershell.js";
import { createWebTool } from "./web.js";
import { createCustomTool } from "./custom.js";

export { ToolRegistry } from "./registry.js";
export type { Approval, Tool, ToolContext } from "./registry.js";

export interface ToolOptions {
  dryRun?: boolean;
  /** null / undefined = every tool; otherwise only these names. */
  enabledTools?: string[] | null;
  /** User-defined commands, exposed through the "custom" tool. */
  customTools?: CustomTool[];
  /** Search page template (`{q}` = query) for the web tool. */
  webSearchUrl?: string;
}

/** Build the Windows tool set, honouring the enabled/custom configuration. */
export function createWindowsTools(approval: Approval, options: ToolOptions = {}): ToolRegistry {
  const registry = new ToolRegistry(approval, options.dryRun ?? false)
    .register(filesTool)
    .register(systemTool)
    .register(processesTool)
    .register(servicesTool)
    .register(networkTool)
    .register(createWebTool({ searchUrl: options.webSearchUrl }))
    .register(scheduledTasksTool)
    .register(registryTool)
    .register(uiTool)
    .register(powershellTool);

  if (options.customTools && options.customTools.length > 0) {
    registry.register(createCustomTool(options.customTools));
  }

  return registry.filter(options.enabledTools ?? null);
}
