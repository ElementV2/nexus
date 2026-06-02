import { create } from "zustand";

/**
 * CLIENT-side log buffer. Lives entirely in the browser tab's memory —
 * NOT persisted, NOT sent to the server, NOT an SSE subscription. A page
 * refresh (F5) wipes it, which is intentional: it's a live session monitor,
 * not an archive. The persistent, after-the-fact record is the server's CSV
 * file (written by the launcher). Keeping the two apart avoids needless
 * server round-trips just to look at what the UI is doing.
 *
 * Fed by `@/lib/client-log` (explicit `clientLog.*` calls + a global capture
 * of window errors / console.warn / console.error). Read by the Logs page.
 */

export type ClientLogLevel = "debug" | "info" | "warn" | "error";

export interface ClientLogEntry {
  /** Monotonic id — stable React key + insertion order (ts can collide at ms). */
  id: number;
  ts: number;
  level: ClientLogLevel;
  scope: string;
  message: string;
}

// Hard cap so a long session (or an error storm) can't grow the tab's heap
// without bound. Oldest entries fall off the front.
const MAX_ENTRIES = 3000;

interface LogStore {
  entries: ClientLogEntry[];
  add: (level: ClientLogLevel, scope: string, message: string) => void;
  clear: () => void;
}

let seq = 0;

export const useLogStore = create<LogStore>((set) => ({
  entries: [],
  add: (level, scope, message) =>
    set((s) => {
      const entry: ClientLogEntry = {
        id: ++seq,
        ts: Date.now(),
        level,
        scope,
        message,
      };
      const arr = s.entries;
      // Trim from the front once we're at the cap (drop oldest).
      const base = arr.length >= MAX_ENTRIES ? arr.slice(arr.length - MAX_ENTRIES + 1) : arr.slice();
      base.push(entry);
      return { entries: base };
    }),
  clear: () => set({ entries: [] }),
}));
