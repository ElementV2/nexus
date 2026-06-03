/**
 * Browser-side wrapper around the Ableton broker's command surface.
 * Mirrors `src/lib/vmix/api.ts` so each subsystem has a single client
 * entry-point instead of inline `fetch` calls scattered through page
 * components.
 *
 * Errors are surfaced via SSE status, not propagated — the launchpad
 * UI doesn't want a thrown rejection on a missed beat to break the
 * grid render.
 *
 * Internally resolves the first enabled connection of kind="ableton"
 * via `/api/connections` (cached for 10 s) so callers don't have to
 * know the connection id. Single-instance limitation matches the
 * Phase-0 adapter — multi-Ableton support will require a Provider
 * that explicitly picks an id.
 */

import { createClientLogger } from "@/lib/client-log";
import { describe } from "@/hooks/use-connection-command";

const log = createClientLogger("command");

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

interface ConnectionListItem {
  id: string;
  kind: string;
  enabled: boolean;
}

let cachedId: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

/**
 * Resolve the connection id of the first enabled ableton kind. Cached
 * so a flurry of commands (launchpad mash, transport play) doesn't
 * hammer `/api/connections`. Falls back to the previous cache value on
 * fetch failure so a transient network blip doesn't kill the next
 * command attempt.
 */
async function resolveId(): Promise<string | null> {
  const now = Date.now();
  if (cachedId && now - cachedAt < CACHE_TTL_MS) return cachedId;
  try {
    const res = await fetch("/api/connections", { cache: "no-store" });
    if (!res.ok) return cachedId;
    const json = (await res.json()) as { connections: ConnectionListItem[] };
    const match = json.connections?.find(
      (c) => c.kind === "ableton" && c.enabled
    );
    if (match) {
      cachedId = match.id;
      cachedAt = now;
    } else {
      cachedId = null;
    }
    return cachedId;
  } catch {
    return cachedId;
  }
}

export async function sendAbletonCommand(body: AbletonCommand): Promise<void> {
  // Log under the same "command" scope + format as every other page (vMix/OBS
  // go through useConnectionCommand). This helper bypasses that hook, so
  // without this Ableton commands were invisible in the client log — the fetch
  // capture skips `/command`, expecting the hook to log it.
  const { name, detail, noisy } = describe(body);
  const tag = detail ? `${name} ${detail}` : name;
  const id = await resolveId();
  if (!id) {
    log.warn(`${tag} — no Ableton connection`);
    return;
  }
  try {
    const res = await fetch(`/api/connections/${encodeURIComponent(id)}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* keep status */
      }
      log.warn(`${tag} ✗ ${msg}`);
      return;
    }
    if (noisy) log.debug(`${tag} ✓`);
    else log.info(`${tag} ✓`);
  } catch (err) {
    log.warn(`${tag} ✗ ${err instanceof Error ? err.message : "Network error"}`);
  }
}
