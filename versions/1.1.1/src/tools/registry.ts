import type { ToolSchema } from "../llm.js";

/** Per-execution context handed to every tool. */
export interface ToolContext {
  /** When true, destructive tools must report what they would do instead of doing it. */
  dryRun: boolean;
  /** Ask the user to approve a destructive action. Resolves false if denied. */
  approve(summary: string): Promise<boolean>;
}

export interface Tool {
  schema: ToolSchema;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/* -------------------------------------------------------------------------- */
/* Argument helpers - small models produce loose JSON, so validate generously. */
/* -------------------------------------------------------------------------- */

export function arg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number") return String(value);
  throw new Error(`missing required string argument "${key}"`);
}

export function argOpt(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function argNum(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function argBool(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|1)$/i.test(value)) return true;
    if (/^(false|no|0)$/i.test(value)) return false;
  }
  return fallback;
}

export function argEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = arg(args, key);
  const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  if (!match) {
    throw new Error(`unknown ${key} "${value}". Valid values: ${allowed.join(", ")}`);
  }
  return match;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export type Approval = (summary: string) => Promise<boolean>;

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(
    private readonly approval: Approval,
    private readonly dryRun = false,
  ) {}

  register(tool: Tool): this {
    this.tools.set(tool.schema.function.name, tool);
    return this;
  }

  /** Keep only the named tools. Pass null to keep everything. */
  filter(keep: string[] | null): this {
    if (!keep) return this;
    for (const name of [...this.tools.keys()]) {
      if (!keep.includes(name)) this.tools.delete(name);
    }
    return this;
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Markdown-ish catalog injected into the system prompt to guide small models. */
  describe(): string {
    const lines: string[] = ["Available tools (call them exactly by name):"];
    for (const tool of this.tools.values()) {
      const fn = tool.schema.function;
      const props = fn.parameters.properties as Record<string, { enum?: string[] }> | undefined;
      const actions = props?.action?.enum;
      lines.push(`- ${fn.name}: ${fn.description}`);
      if (actions) lines.push(`    action must be one of: ${actions.join(", ")}`);
    }
    lines.push("");
    lines.push("Always pass arguments as a single JSON object. Prefer these tools over guessing commands.");
    lines.push(
      [
        "If you cannot call functions directly, reply with one fenced JSON block and nothing else:",
        "```json",
        '{"tool": "<tool name>", "arguments": {"action": "...", "...": "..."}}',
        "```",
        "The result comes back as a tool message; then answer in plain text.",
      ].join("\n"),
    );
    return lines.join("\n");
  }

  /** Execute a tool by name. Errors are returned as text so the model can react. */
  async execute(name: string, rawArguments: string): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: unknown tool "${name}". Available tools: ${this.names().join(", ")}`;
    }

    let args: Record<string, unknown>;
    try {
      args = rawArguments.trim() ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
    } catch {
      return `Error: arguments for "${name}" were not valid JSON: ${rawArguments}`;
    }

    const ctx: ToolContext = {
      dryRun: this.dryRun,
      approve: this.approval,
    };

    try {
      return await tool.run(args, ctx);
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }
  }
}
