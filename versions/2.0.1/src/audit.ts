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
 * the machine back; those are what `/undo` (or the rollback button in the web UI)
 * runs.
 *
 * The log *is* the stack. What can be undone is rebuilt from the file on every
 * request instead of being held in memory, so a change made last Tuesday can still
 * be rolled back today and a restart loses nothing. The copies that a "restore"
 * needs live in `data/undo/` and are kept for `undoRetentionDays` (7 by default).
 *
 * One deliberate limit, documented in the README: a step only restores what it is
 * sure about. A file that is too large to copy aside is changed but *not* undoable,
 * and the entry says so. When a copy has gone (past the retention window, or deleted
 * by hand) its entry stops being undoable instead of half-restoring anything.
 */

/** One instruction that puts something back the way it was. */
export type UndoStep =
  | { kind: "restore"; path: string; backup: string }
  | { kind: "remove"; path: string }
  | { kind: "rmdir"; path: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "script"; label: string; script: string };

export interface AuditEntry {
  /** 1-based and unique across runs: undo records point at a change by this number. */
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

/** What an undo (one entry or the newest few) did. */
export interface UndoResult {
  ok: boolean;
  undone: AuditEntry[];
  failures: string[];
  message: string;
}

/** Nothing larger than this is copied aside to be undoable. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
/** The log is trimmed to the newest entries once it grows past this. */
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const KEEP_LOG_LINES = 1000;
/** Undo entries kept in memory (the file keeps much more). */
const MAX_MEMORY_ENTRIES = 400;
/** Copies are kept for this long unless the user says otherwise. */
const DEFAULT_RETENTION_DAYS = 7;
/** A day either way, so a retention change never deletes today's copies by accident. */
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;

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
  private seqLoaded = false;
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

  /** How long copies are kept: the `undoRetentionDays` setting, clamped to a sane range. */
  retentionDays(): number {
    const days = Math.trunc(Number(getSettings().undoRetentionDays));
    if (!Number.isFinite(days) || days < MIN_RETENTION_DAYS) return DEFAULT_RETENTION_DAYS;
    return Math.min(days, MAX_RETENTION_DAYS);
  }

  /**
   * Delete the copies that are older than the retention window, once per run.
   *
   * The window is the whole point of keeping the log: a copy deleted the moment the
   * server stops is a copy nobody can roll back to tomorrow. `sweep()` is called by
   * `backup()` and by the server at start, and it only ever deletes what is already
   * past the window - never a copy a still-undoable entry points at.
   */
  async sweep(): Promise<void> {
    if (this.swept) return;
    this.swept = true;
    const cutoff = Date.now() - this.retentionDays() * 86_400_000;
    let names: string[];
    try {
      names = await fsp.readdir(this.backupDirPath);
    } catch {
      return; // no folder yet: nothing to sweep
    }
    for (const name of names) {
      const full = path.join(this.backupDirPath, name);
      try {
        const stat = await fsp.lstat(full);
        if (stat.mtimeMs < cutoff) await fsp.rm(full, { recursive: true, force: true });
      } catch {
        // something moved it already; leaving it is harmless
      }
    }
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
  /**
   * Pick a copy name that is not taken yet. The counter alone is not enough: two
   * processes (the web UI and an `--mcp-server` run, say) each start at zero, and
   * the second would overwrite the first one's copy - leaving an older entry
   * pointing at a file that now holds the *newer* content. Make the name unique
   * against what is already in the folder instead.
   */
  private async copyName(base: string): Promise<string> {
    await fsp.mkdir(this.backupDirPath, { recursive: true });
    const used = new Set(await fsp.readdir(this.backupDirPath).catch(() => []));
    let index = ++this.copies;
    let name = `${String(index).padStart(4, "0")}-${base}`;
    while (used.has(name)) {
      index += 1;
      name = `${String(index).padStart(4, "0")}-${base}`;
    }
    this.copies = index;
    return path.join(this.backupDirPath, name);
  }

  async backup(target: string): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink()) return null;
      if ((await treeSize(target, MAX_BACKUP_BYTES)) > MAX_BACKUP_BYTES) return null;
      // Copies older than the retention window can go; the ones a pending entry
      // still points at are inside it (see sweep()).
      await this.sweep();
      const base = (path.basename(target) || "item").slice(0, 60);
      const copy = await this.copyName(base);
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
      seq: this.nextSeq(),
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
    const all = this.readAll();
    if (all.length === 0) return [...this.entries].reverse().slice(0, limit);
    return all.reverse().slice(0, limit);
  }

  /** What `/undo` could reverse right now, newest first - rebuilt from the log. */
  pending(): AuditEntry[] {
    const all = this.readAll();
    const reversed = new Set<number>();
    for (const entry of all) {
      if (entry.action === "undo" && typeof entry.ref === "number") reversed.add(entry.ref);
    }
    return all
      .filter((entry) => entry.undoable && !reversed.has(entry.seq) && this.reversible(entry))
      .reverse();
  }

  /**
   * True when every step of the entry can still run. A `restore` step whose copy is
   * gone would delete the current file and put nothing back - worse than saying
   * this one can no longer be undone.
   */
  private reversible(entry: AuditEntry): boolean {
    return entry.steps.every((step) => step.kind !== "restore" || fs.existsSync(step.backup));
  }

  /**
   * Reverse the newest `count` changes that can be reversed. Steps of one entry
   * run in reverse order, so the last thing done is the first thing undone.
   */
  async undo(count = 1): Promise<UndoResult> {
    if (!this.enabled) {
      return { ok: false, undone: [], failures: [], message: "the audit log is switched off" };
    }
    const wanted = Number.isFinite(count) ? Math.max(1, Math.trunc(count)) : 1;
    return this.reverse(this.pending().slice(0, wanted));
  }

  /** Reverse one specific change - the rollback button next to it in the web UI. */
  async undoEntry(seq: number): Promise<UndoResult> {
    if (!this.enabled) {
      return { ok: false, undone: [], failures: [], message: "the audit log is switched off" };
    }
    const entry = this.pending().find((item) => item.seq === seq);
    if (!entry) {
      return {
        ok: false,
        undone: [],
        failures: [],
        message: "that change can no longer be undone (already undone, or its backup has expired)",
      };
    }
    return this.reverse([entry]);
  }

  /** Run the steps of the given entries and record each reversal in the log. */
  private async reverse(entries: AuditEntry[]): Promise<UndoResult> {
    const undone: AuditEntry[] = [];
    const failures: string[] = [];
    for (const entry of entries) {
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
        seq: this.nextSeq(),
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

  /**
   * Every record in the log, oldest first. The log is the undo stack, so this is
   * the one reader both `list()` and `pending()` go through.
   */
  private readAll(): AuditEntry[] {
    let text: string;
    try {
      text = fs.readFileSync(this.file(), "utf8");
    } catch {
      return [];
    }
    const out: AuditEntry[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as AuditEntry);
      } catch {
        // A half-written last line after a crash; skip it rather than die.
      }
    }
    return out;
  }

  /**
   * The next number, continuing where the last run stopped - an undo record points
   * at the change it reversed by number, so the numbers have to be unique across
   * runs (and across writers), not just within one.
   */
  private nextSeq(): number {
    // Another instance may have appended since our last write; a size that no
    // longer matches what we wrote is the cheap signal to re-read the log.
    if (this.seqLoaded) {
      let size = -1;
      try {
        size = fs.statSync(this.file()).size;
      } catch {
        size = -1;
      }
      if (size !== this.bytes) this.seqLoaded = false;
    }
    if (!this.seqLoaded) {
      this.seqLoaded = true;
      const all = this.readAll();
      this.seq = all.length > 0 ? all[all.length - 1].seq : 0;
    }
    return ++this.seq;
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
