/**
 * Browser-side wrapper around the `/api/ableton/command` route.
 * Mirrors `src/lib/vmix/api.ts` so each subsystem has a single client
 * entry-point instead of inline `fetch` calls scattered through page
 * components.
 *
 * Errors are surfaced via SSE status, not propagated — the launchpad
 * UI doesn't want a thrown rejection on a missed beat to break the
 * grid render.
 */

export type AbletonCommand =
  | { action: "fire-clip"; track: number; scene: number }
  | { action: "stop-track"; track: number }
  | { action: "stop-all" }
  | { action: "play" }
  | { action: "stop" }
  | { action: "continue" }
  | { action: "tap-tempo" }
  | { action: "set-tempo"; bpm: number }
  | { action: "set-metronome"; on: boolean }
  | { action: "refresh-snapshot" }
  | {
      action: "raw";
      address: string;
      args?: (number | string | boolean | null)[];
    };

export async function sendAbletonCommand(body: AbletonCommand): Promise<void> {
  try {
    await fetch("/api/ableton/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* surfaced via SSE status */
  }
}
