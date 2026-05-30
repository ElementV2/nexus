import { connectionManager } from "./connection-manager";
import { getPreferences } from "@/lib/db/preferences";

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
  });
  void import("@/lib/streamdeck/press-dispatcher").then((m) => {
    m.pressDispatcher.start();
  });
}

/**
 * Reload the manager state from persisted preferences. Called after
 * any preferences write so the broker map matches what the UI just
 * saved — no need for a stale-config window.
 */
export function reconcileFromPreferences(): void {
  const prefs = getPreferences();
  connectionManager.reconcile(prefs.connections ?? []);
}
