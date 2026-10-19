import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { getSettings } from "./settings.js";
import { dataDir } from "./store.js";

/**
 * Audit log and undo stack.
 *
 * Every change a tool makes is written to `data/audit.jsonl` - one JSON object per
 * line, append-only, so the file is readable by `Get-Content -Tail` and survives a
 * crash. Changes that can be *faithfully* reversed also carry the steps that put
 * the machine back; those go onto an in-memory stack that `/undo` (or the Undo
 * button in the web UI) pops.
 *
 * Two deliberate limits, both documented in the README:
 *  - the undo stack lives in memory only, so it is empty after a restart (the log
 *    still shows what happened);
 *  - a step only restores what it is sure about. A file that is too large to copy
 *    aside is changed but *not* undoable, and the entry says so.
 */

/** One instruction that puts something back the way it was. */
export type UndoStep =
  | { kind: "restore"; path: string; backup: string }
  | { kind: "remove"; path: string }
  | { kind: "rmdir"; path: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "script"; label: string; script: string };

export interface AuditEntry {
  /** 1-based, counted per server run. */
  seq: number;
  time: string;
  tool: string;
  action: string;
  /** One line for a human: what was changed. */
  summary: string;
  paths: string[];
  undoable: boolean;
  steps: UndoStep[];
  /** Only set on the "undo" records that are appended when a change is reversed. */
  ref?: number;
  /** Set in memory (never written to the line above) once this change was reversed. */
  undone?: boolean;
}

export interface AuditInput {
  action: string;
  summary: string;
  paths?: string[];
  /** Empty/undefined means "logged, but not reversible". */
  steps?: UndoStep[];
  tool?: string;
}

/** Nothing larger than this is copied aside to be undoable. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
/** The log is trimmed to the newest entries once it grows past this. */
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const KEEP_LOG_LINES = 1000;
/** Undo entries kept in memory (the file keeps much more). */
const MAX_MEMORY_ENTRIES = 400;

/** Total size of a file or folder tree, stopping early once `limit` is passed. */
async function treeSize(target: string, limit: number): Promise<number> {
  const stat = await fsp.lstat(target);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  const stack = [target];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // Never follow a link or a junction: a loop would run forever.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          total += (await fsp.lstat(full)).size;
        } catch {
          // vanished while we walked; ignore
        }
        if (total > limit) return total;
      }
    }
  }
  return total;
}

/** Run one recorded step. Idempotent where it can be: `/undo` twice must not hurt. */
async function runStep(step: UndoStep): Promise<void> {
  switch (step.kind) {
    case "restore":
      await fsp.rm(step.path, { recursive: true, force: true });
      await fsp.cp(step.backup, step.path, { recursive: true, force: true });
      return;
    case "remove":
      await fsp.rm(step.path, { recursive: true, force: true });
      return;
    case "rmdir":
      // Deliberately not recursive: if something else was put inside since, undo
      // must not throw it away.
      await fsp.rmdir(step.path);
      return;
    case "move":
      await fsp.rename(step.from, step.to);
      return;
    case "script": {
      const { runPs } = await import("./util/ps.js");
      await runPs(step.script);
      return;
    }
  }
}

export function stepLabel(step: UndoStep): string {
  switch (step.kind) {
    case "restore":
      return `restore ${step.path}`;
    case "remove":
      return `delete ${step.path}`;
    case "rmdir":
      return `remove folder ${step.path}`;
    case "move":
      return `move ${step.from} -> ${step.to}`;
    case "script":
      return step.label;
  }
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private readonly backupDirPath: string;
  private seq = 0;
  private copies = 0;
  private bytes = 0;
  private swept = false;
  private problem: string | null = null;

  constructor(
    private readonly dir: string,
    private enabled: boolean,
  ) {
    this.backupDirPath = path.join(dir, "undo");
    try {
      this.bytes = fs.statSync(this.file()).size;
    } catch {
      this.bytes = 0;
    }
  }

  /** The append-only log file. */
  file(): string {
    return path.join(this.dir, "audit.jsonl");
  }

  /** Where "put it back" copies are kept while they can still be needed. */
  backupDir(): string {
    return this.backupDirPath;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Why the log is not being written, if it is not (surfaced in /status). */
  error(): string | null {
    return this.problem;
  }

  /**
   * Copy a file or folder aside before it is changed, so `/undo` can put it back.
   * Returns the location of the copy, or null when nothing can be saved (new file,
   * too large, unreadable, or the log is switched off) - the caller then records
   * the change as not undoable.
   */
  async backup(target: string): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink()) return null;
      if ((await treeSize(target, MAX_BACKUP_BYTES)) > MAX_BACKUP_BYTES) return null;
      // Copies from an earlier run can never be reached again - the stack that
      // points at them is gone - so start every run with an empty folder.
      if (!this.swept) {
        this.swept = true;
        await fsp.rm(this.backupDirPath, { recursive: true, force: true });
      }
      await fsp.mkdir(this.backupDirPath, { recursive: true });
      const base = (path.basename(target) || "item").slice(0, 60);
      const copy = path.join(this.backupDirPath, `${String(++this.copies).padStart(4, "0")}-${base}`);
      await fsp.cp(target, copy, { recursive: true, verbatimSymlinks: true });
      return copy;
    } catch {
      return null;
    }
  }

  /** Record a finished change. Returns the entry, or null when logging is off. */
  record(input: AuditInput): AuditEntry | null {
    if (!this.enabled) return null;
    const entry: AuditEntry = {
      seq: ++this.seq,
      time: new Date().toISOString(),
      tool: input.tool ?? "",
      action: input.action,
      summary: input.summary,
      paths: input.paths ?? [],
      undoable: (input.steps ?? []).length > 0,
      steps: input.steps ?? [],
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_MEMORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_MEMORY_ENTRIES);
    }
    this.append(entry);
    return entry;
  }

  /** The newest entries, read back from the log file (newest first). */
  list(limit = 20): AuditEntry[] {
    let lines: string[];
    try {
      lines = fs.readFileSync(this.file(), "utf8").split(/\r?\n/);
    } catch {
      return [...this.entries].reverse().slice(0, limit);
    }
    const out: AuditEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as AuditEntry);
      } catch {
        // A half-written last line after a crash; skip it rather than die.
      }
    }
    return out;
  }

  /** What `/undo` would reverse right now, newest first. */
  pending(): AuditEntry[] {
    return [...this.entries].reverse().filter((entry) => entry.undoable && !entry.undone);
  }

  /**
   * Reverse the newest `count` changes that can be reversed. Steps of one entry
   * run in reverse order, so the last thing done is the first thing undone.
   */
  async undo(
    count = 1,
  ): Promise<{ ok: boolean; undone: AuditEntry[]; failures: string[]; message: string }> {
    if (!this.enabled) {
      return { ok: false, undone: [], failures: [], message: "the audit log is switched off" };
    }
    const undone: AuditEntry[] = [];
    const failures: string[] = [];
    for (let i = 0; i < count; i++) {
      const entry = this.entries.filter((item) => item.undoable && !item.undone).pop();
      if (!entry) break;
      for (const step of [...entry.steps].reverse()) {
        try {
          await runStep(step);
        } catch (error) {
          failures.push(`${stepLabel(step)}: ${(error as Error).message}`);
        }
      }
      entry.undone = true;
      undone.push(entry);
      this.append({
        seq: ++this.seq,
        time: new Date().toISOString(),
        tool: "undo",
        action: "undo",
        summary: `undid ${entry.tool} ${entry.action}: ${entry.summary}`,
        paths: entry.paths,
        undoable: false,
        steps: [],
        ref: entry.seq,
      });
      await this.dropCopies(entry);
    }
    if (undone.length === 0) {
      return failures.length > 0
        ? { ok: false, undone, failures, message: failures.join("; ") }
        : { ok: false, undone, failures, message: "nothing to undo" };
    }
    const summary = undone.map((entry) => `${entry.tool} ${entry.action}`).join(", ");
    return {
      ok: failures.length === 0,
      undone,
      failures,
      message: failures.length === 0 ? summary : `${summary} (with problems: ${failures.join("; ")})`,
    };
  }

  /** Forget the copies a reversed entry needed. */
  private async dropCopies(entry: AuditEntry): Promise<void> {
    for (const step of entry.steps) {
      try {
        if (step.kind === "restore") await fsp.rm(step.backup, { recursive: true, force: true });
      } catch {
        // a leftover copy is harmless; the folder is swept next run
      }
    }
  }

  private append(entry: AuditEntry): void {
    const line = `${JSON.stringify(entry)}\n`;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.file(), line);
      this.bytes += Buffer.byteLength(line);
      if (this.bytes > MAX_LOG_BYTES) this.trim();
    } catch (error) {
      // A full disk must not break the tool that is reporting success; say so
      // once, in /status, instead.
      this.problem = `could not write ${this.file()}: ${(error as Error).message}`;
    }
  }

  /** Keep the newest lines and start over, so the log cannot grow without end. */
  private trim(): void {
    try {
      const file = this.file();
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim());
      const text = lines.slice(-KEEP_LOG_LINES).join("\n") + "\n";
      fs.writeFileSync(file, text);
      this.bytes = Buffer.byteLength(text);
    } catch {
      this.bytes = 0;
    }
  }
}

/* -------------------------------------------------------------------------- */

let singleton: AuditLog | null = null;

/** The audit log of this run (created on first use, so it picks up the settings). */
export function auditLog(): AuditLog {
  if (!singleton) singleton = new AuditLog(dataDir(), getSettings().auditLog);
  return singleton;
}

/** Apply the `auditLog` setting. Called whenever settings change. */
export function configureAudit(enabled: boolean): void {
  auditLog().setEnabled(enabled);
}
