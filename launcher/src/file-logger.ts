import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ServerLog } from "./server-manager";

/**
 * Appends every Server Activity entry to a dated CSV file on disk so a
 * crash or bug can be diagnosed AFTER the fact — the in-memory ring buffer
 * (500 lines) is gone the moment the launcher quits or the window reloads,
 * which is exactly when you most need the history.
 *
 * CSV, not a flat log, on purpose: it opens straight into Excel / Sheets
 * with one column per field (Time, Level, Scope, Message), so an operator
 * (or whoever receives a bug report) can auto-filter to ERROR/WARN, sort by
 * Scope, or search the Message column without any tooling. A header row is
 * written first so Excel labels the columns and "Filter" just works.
 *
 * One file per local day: `nexus-YYYY-MM-DD.csv`. Timestamps are LOCAL
 * time (not UTC) and zero-padded so a lexical sort is also a chronological
 * sort. Files older than RETENTION_DAYS are pruned on startup so the folder
 * never grows without bound.
 */

const RETENTION_DAYS = 30;
const FILE_PREFIX = "nexus-";
const FILE_SUFFIX = ".csv";
// Leading BOM (﻿) so Excel opens the CSV as UTF-8 and renders accented
// French messages correctly instead of mojibake.
const CSV_HEADER = "﻿Time,Level,Scope,Message\n";

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Local date as `YYYY-MM-DD` — used for the per-day filename. */
function localDateStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local wall-clock time as `YYYY-MM-DD HH:MM:SS.mmm`. */
function localTimestamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${localDateStamp(d)} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** RFC-4180 CSV field: quote if it contains a comma, quote, or newline, and
 *  double any embedded quotes. Newlines are collapsed to spaces so one log
 *  entry stays one spreadsheet row (multi-line stacks already arrive as
 *  separate entries). */
function csv(field: string): string {
  const flat = field.replace(/\r?\n/g, " ");
  if (/[",]/.test(flat)) return `"${flat.replace(/"/g, '""')}"`;
  return flat;
}

const LEVEL_LABEL: Record<ServerLog["level"], string> = {
  info: "INFO",
  warn: "WARN",
  err: "ERROR",
};

export class FileLogger {
  private dir: string;
  /** The day stamp the current file path was computed for; when the wall
   *  clock crosses midnight we recompute so a long-running launcher rolls
   *  over to a fresh file without a restart. */
  private currentDay = "";
  private currentPath = "";
  private failed = false;

  constructor(dataDir: string) {
    this.dir = join(dataDir, "logs");
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      this.pruneOld();
    } catch {
      // A logging subsystem must never take down the launcher. If the dir
      // can't be created (permissions, read-only volume) we silently skip
      // file logging — the in-memory ring + on-screen panel still work.
      this.failed = true;
    }
  }

  /** Absolute path of the logs folder (for the "open logs" button). */
  directory(): string {
    return this.dir;
  }

  /** Resolve today's file path, writing the CSV header if the file is new
   *  (or a new day just rolled over to a fresh file). */
  private filePathForToday(): string {
    const day = localDateStamp(new Date());
    if (day !== this.currentDay) {
      this.currentDay = day;
      this.currentPath = join(this.dir, `${FILE_PREFIX}${day}${FILE_SUFFIX}`);
    }
    // Header on a brand-new (or emptied) file so Excel gets column labels.
    let needsHeader = true;
    try {
      needsHeader = !existsSync(this.currentPath) || statSync(this.currentPath).size === 0;
    } catch {
      needsHeader = false;
    }
    if (needsHeader) {
      try {
        appendFileSync(this.currentPath, CSV_HEADER, "utf-8");
      } catch {
        /* header is best-effort */
      }
    }
    return this.currentPath;
  }

  write(entry: ServerLog): void {
    if (this.failed) return;
    try {
      const row =
        `${csv(localTimestamp(entry.ts))},${LEVEL_LABEL[entry.level]},` +
        `${csv(entry.scope || "")},${csv(entry.message)}\n`;
      appendFileSync(this.filePathForToday(), row, "utf-8");
    } catch {
      // Don't latch `failed` on a transient write error (e.g. file locked by
      // an editor) — the next line may well succeed. Just drop this one.
    }
  }

  /** Delete log files older than the retention window. Best-effort. */
  private pruneOld(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(this.dir)) {
      if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) continue;
      const full = join(this.dir, name);
      try {
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
      } catch {
        /* skip files we can't stat/remove */
      }
    }
  }
}
