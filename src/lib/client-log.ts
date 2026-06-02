import { useLogStore, type ClientLogLevel } from "@/stores/log-store";

/**
 * Browser-side logger. Writes into the in-tab `useLogStore` (see that file
 * for the "why client-only / why no SSE" rationale). Two ways things land
 * in the log:
 *
 *   1. Explicit `clientLog.*` / `createClientLogger(scope).*` calls.
 *   2. A global capture (installed once via `initClientLogCapture`) that
 *      mirrors uncaught errors, unhandled promise rejections, and every
 *      `console.warn` / `console.error` into the store — so even code that
 *      never heard of this logger still shows up when it goes wrong.
 *
 * Nothing here touches the network.
 */

function format(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function push(level: ClientLogLevel, scope: string, parts: unknown[]): void {
  useLogStore.getState().add(level, scope, parts.map(format).join(" "));
}

export interface ClientLogger {
  debug(...parts: unknown[]): void;
  info(...parts: unknown[]): void;
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
}

/** Scoped logger — `createClientLogger("obs").warn(...)` tags the line with
 *  its subsystem so the Logs page can filter by source. */
export function createClientLogger(scope: string): ClientLogger {
  return {
    debug: (...parts) => push("debug", scope, parts),
    info: (...parts) => push("info", scope, parts),
    warn: (...parts) => push("warn", scope, parts),
    error: (...parts) => push("error", scope, parts),
  };
}

export const clientLog = createClientLogger("app");

// A console line the app already emits often carries its own `[scope]`
// prefix (e.g. `console.warn("[obs] ...")`). Lift it into the scope column
// instead of leaving it buried in the message.
// `[\s\S]` instead of `.` + /s flag so a multi-line message (stack trace)
// is captured whole without needing the dotall flag (unavailable on the
// client's compile target).
const SCOPE_PREFIX = /^\s*\[([^\]]+)\]\s*([\s\S]*)$/;

function recordConsole(level: ClientLogLevel, args: unknown[]): void {
  const message = args.map(format).join(" ");
  const m = SCOPE_PREFIX.exec(message);
  if (m) push(level, m[1], [m[2]]);
  else push(level, "console", [message]);
}

let captureInstalled = false;

/**
 * Install the global browser capture. Idempotent — safe to call on every
 * mount. Patches console.warn/error (preserving their original behaviour so
 * the devtools console still works) and listens for uncaught errors +
 * unhandled rejections. No-op on the server.
 */
export function initClientLogCapture(): void {
  if (captureInstalled || typeof window === "undefined") return;
  captureInstalled = true;

  window.addEventListener("error", (e: ErrorEvent) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : "";
    push("error", "window", [
      e.error instanceof Error ? e.error.stack || e.message : e.message + where,
    ]);
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    push("error", "window", [
      "Unhandled promise rejection —",
      e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason),
    ]);
  });

  // Mirror console.warn / console.error into the store, then call through to
  // the real console so devtools is unaffected. We capture the originals so
  // the mirror can't recurse if something later re-patches console.
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...args: unknown[]) => {
    recordConsole("warn", args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    recordConsole("error", args);
    origError(...args);
  };

  installFetchCapture();
}

/**
 * Wrap `window.fetch` so EVERY server call the UI makes is logged — no
 * per-hook instrumentation, no holes. Reads (GET/HEAD) land at DEBUG;
 * mutations (POST/PUT/PATCH/DELETE) at INFO so operator-driven saves/
 * deletes stand out; any non-2xx or network failure at WARN with the
 * status. We DON'T re-log two endpoints handled better elsewhere:
 *   • `/command` — useConnectionCommand logs it with a readable action name.
 *   • `/api/stream` — the SRT player logs its own lifecycle (and it's a
 *     minutes-long stream, so a request-duration line would be misleading).
 */
function installFetchCapture(): void {
  if (typeof window.fetch !== "function") return;
  const orig = window.fetch.bind(window);
  const log = createClientLogger("http");

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (
      init?.method ||
      (typeof input === "object" && "method" in input ? (input as Request).method : "GET") ||
      "GET"
    ).toUpperCase();
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    // Show just the path (drop the origin) for a compact, readable line.
    let path = rawUrl;
    try {
      path = new URL(rawUrl, window.location.origin).pathname;
    } catch {
      /* keep rawUrl */
    }

    // Skip: command (logged by name elsewhere), the SRT stream (player logs
    // its own lifecycle), and Next.js internals (RSC/prefetch/static chunks
    // would bury real app traffic).
    const skip =
      path.includes("/command") ||
      path.startsWith("/api/stream") ||
      path.startsWith("/_next");
    const t0 = performance.now();
    try {
      const res = await orig(input, init);
      if (!skip) {
        const ms = Math.round(performance.now() - t0);
        if (!res.ok) log.warn(`${method} ${path} → ${res.status} (${ms}ms)`);
        else if (method === "GET" || method === "HEAD") log.debug(`${method} ${path} → ${res.status} (${ms}ms)`);
        else log.info(`${method} ${path} → ${res.status} (${ms}ms)`);
      }
      return res;
    } catch (err) {
      if (!skip) {
        const ms = Math.round(performance.now() - t0);
        log.warn(`${method} ${path} ✗ ${err instanceof Error ? err.message : String(err)} (${ms}ms)`);
      }
      throw err;
    }
  };
}
