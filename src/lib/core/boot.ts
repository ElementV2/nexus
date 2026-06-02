import { connectionManager } from "./connection-manager";
import { getPreferences } from "@/lib/db/preferences";
import { createLogger } from "./logger";

const log = createLogger("boot");

// Side-effect imports: each module calls `registerDeviceKind(...)`
// at top level. Adding a new kind = one new import line here.
import "@/lib/kinds/vmix";
import "@/lib/kinds/obs";
import "@/lib/kinds/ableton";
import "@/lib/kinds/x32";
import "@/lib/kinds/grandma3";
import "@/lib/kinds/grandma2";

/**
 * One-time boot of the connection manager. Idempotent — every API
 * route that touches connections calls this; only the first call
 * actually reconciles.
 *
 * Two roles:
 *   1. Force-load all kind modules so `registry` knows about them
 *      before the first config validation or broker construction.
 *   2. Materialize the persisted `connections[]` from preferences
 *      into live broker instances.
 *
 * The reconciler is also called after every preferences PUT so this
 * boot just covers the cold-start window.
 */

const BOOT_KEY = "__nexus_connection_boot__";

interface BootStash {
  booted: boolean;
}

function getStash(): BootStash {
  const holder = globalThis as unknown as Record<string, unknown>;
  let stash = holder[BOOT_KEY] as BootStash | undefined;
  if (!stash) {
    stash = { booted: false };
    holder[BOOT_KEY] = stash;
  }
  return stash;
}

export function ensureBooted(): void {
  const stash = getStash();
  if (stash.booted) return;
  stash.booted = true;
  // Install the process-wide crash handlers FIRST so anything that throws
  // during the rest of boot still lands in the log file with a full stack.
  registerCrashHandlers();
  log.info("booting device runtime");
  reconcileFromPreferences();
  // Start the Stream Deck server-side runtime: the feedback
  // coordinator (variable → render override) AND the press
  // dispatcher (physical key → preset execution). Both must boot
  // AFTER kinds are loaded and connections reconciled — otherwise
  // their first reads would see an empty world.
  //
  // The dispatcher is critical: it subscribes ONCE to the driver
  // and runs the bound preset on press. Before this existed, the
  // SSE route ran the preset inside its per-client subscriber,
  // which meant one physical press fired the preset N times when
  // N tabs were open.
  //
  // Lazy require avoids dragging the streamdeck driver chain into
  // routes that never touch hardware.
  void import("@/lib/streamdeck/feedback-coordinator").then((m) => {
    m.feedbackCoordinator.start();
    log.info("feedback coordinator started");
  });
  void import("@/lib/streamdeck/press-dispatcher").then((m) => {
    m.pressDispatcher.start();
    log.info("press dispatcher started");
  });
  // Start the Companion-Satellite server so on-screen virtual decks
  // (ScreenDeck etc.) can connect in and be driven like any deck. Honors
  // the persisted enable/port (default on, 16622).
  applyScreendeckPreferences();

  registerShutdownReset();
}

/**
 * (Re)apply the persisted ScreenDeck server config — binds/rebinds the
 * Satellite TCP listener on the configured port, or tears it down when
 * disabled. Called at boot and after any preferences write that touches
 * the `screendeck` block. Lazy import keeps the listener + driver chain
 * out of routes that never use it.
 */
export function applyScreendeckPreferences(): void {
  const cfg = getPreferences().screendeck;
  void import("@/lib/streamdeck/screendeck-server").then((m) => {
    m.screendeckServer.apply(cfg);
  });
}

const SHUTDOWN_KEY = "__nexus_shutdown_reset_hook__";

/**
 * Reset connected Stream Decks to the firmware standby logo on a graceful
 * exit (dev `Ctrl+C` → SIGINT, or any SIGTERM) so a closed server doesn't
 * leave stale, dead buttons lit. Guarded on `globalThis` so a Next dev HMR
 * cycle doesn't stack duplicate process listeners.
 *
 * The packaged launcher force-kills the server on Windows (`taskkill /F` —
 * no graceful-signal window), so it instead calls
 * `POST /api/streamdeck/shutdown` right before the kill. This handler is the
 * dev / Unix-signal counterpart.
 */
function registerShutdownReset(): void {
  const holder = globalThis as unknown as Record<string, unknown>;
  if (holder[SHUTDOWN_KEY]) return;
  holder[SHUTDOWN_KEY] = true;
  const handler = (signal: NodeJS.Signals) => {
    log.info(`received ${signal} — resetting decks and shutting down`);
    void import("@/lib/streamdeck/driver")
      .then(({ streamdeckDriver }) => streamdeckDriver.resetAll())
      .catch(() => {})
      .finally(() => process.exit(0));
    // Failsafe: never hang the exit if the reset stalls (dead device, etc.).
    setTimeout(() => process.exit(0), 1500).unref?.();
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}

const CRASH_KEY = "__nexus_crash_handlers__";

/**
 * Catch the two failure modes that otherwise kill the server with NOTHING
 * useful in the log: a synchronous throw with no handler, and a rejected
 * promise nobody awaited. Both are logged with their full stack — that
 * line in the on-disk log file is usually the entire "why did it crash"
 * answer. We deliberately DON'T `process.exit` on uncaughtException: a
 * single bad broker event shouldn't take the whole control surface down
 * mid-show. Guarded on globalThis so a dev HMR cycle doesn't stack
 * duplicate listeners.
 */
function registerCrashHandlers(): void {
  const holder = globalThis as unknown as Record<string, unknown>;
  if (holder[CRASH_KEY]) return;
  holder[CRASH_KEY] = true;
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException —", err);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection —", reason);
  });
}

/**
 * Reload the manager state from persisted preferences. Called after
 * any preferences write so the broker map matches what the UI just
 * saved — no need for a stale-config window.
 */
export function reconcileFromPreferences(): void {
  const prefs = getPreferences();
  const configs = prefs.connections ?? [];
  const enabled = configs.filter((c) => c.enabled).length;
  log.info(`reconciling connections: ${enabled} enabled of ${configs.length}`);
  connectionManager.reconcile(configs);
}
