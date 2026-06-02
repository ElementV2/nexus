/**
 * Tiny structured logger for the Next.js server process.
 *
 * Why this exists: the only window into "why did it crash / why did a
 * button do nothing" is the launcher's Server Activity panel, which
 * simply mirrors this process's stdout/stderr. Scattered `console.log`
 * gave that panel almost nothing. This logger emits one tagged line per
 * event so the launcher can (a) recover the real level and (b) write it
 * to the on-disk log file with the right channel.
 *
 * Line format (single line, human-readable even when run raw):
 *
 *     INFO [scope] message…
 *
 * The leading level token (DEBUG|INFO|WARN|ERROR) is what the launcher
 * parses; continuation lines of a multi-line message (e.g. a stack
 * trace) have no token and inherit the stream's level. We write to
 * stdout for debug/info and stderr for warn/error so a server run
 * WITHOUT the launcher still routes errors to the right stream.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

// Debug lines are noisy (per-event), so they're opt-in via env. Everything
// info-and-up always flows so a field crash report is never missing the
// lifecycle breadcrumbs that explain it.
const DEBUG_ENABLED =
  process.env.NEXUS_LOG_DEBUG === "1" || process.env.NEXUS_LOG_DEBUG === "true";

function format(value: unknown): string {
  if (value instanceof Error) {
    // Keep the stack — it's the whole point of an error log. Continuation
    // lines land in the file too (just without the level token).
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level: LogLevel, scope: string, parts: unknown[]): void {
  if (level === "debug" && !DEBUG_ENABLED) return;
  const message = parts.map(format).join(" ");
  const line = `${level.toUpperCase()} [${scope}] ${message}\n`;
  // process.std*.write (not console.*) so the line is emitted verbatim with
  // no inspector formatting/colour codes that would corrupt the level token.
  if (level === "warn" || level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export interface Logger {
  debug(...parts: unknown[]): void;
  info(...parts: unknown[]): void;
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
  /** Derive a child logger with a nested scope, e.g. `obs:abc123`. */
  child(suffix: string): Logger;
}

/**
 * Create a scoped logger. The scope is shown in every line so a log file
 * read after the fact tells you which subsystem / connection spoke.
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (...parts) => emit("debug", scope, parts),
    info: (...parts) => emit("info", scope, parts),
    warn: (...parts) => emit("warn", scope, parts),
    error: (...parts) => emit("error", scope, parts),
    child: (suffix) => createLogger(`${scope}:${suffix}`),
  };
}
