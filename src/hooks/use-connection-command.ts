"use client";

import { useCallback } from "react";
import { createClientLogger } from "@/lib/client-log";

const log = createClientLogger("command");

/**
 * Result envelope shared by every kind. Mirrors the legacy
 * `useObsCommand` / `useVmixCommand` returns so callers don't have to
 * special-case generic vs. legacy hooks during the migration window.
 */
export type CommandResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * High-frequency / read-only commands that would flood the client log if
 * logged at INFO — fader drags, T-bar scrubs, and `get-*` reads fire many
 * times per gesture. They're still captured, just at DEBUG so the INFO
 * stream stays a readable record of discrete operator actions.
 */
const NOISY = /volume|fader|t-?bar|balance|sync-?offset|position|cursor|meters-enabled|^get-|^ensure-|-list$/i;

/** Pull a readable name + compact detail from a kind command body. OBS uses
 *  `action`, vMix uses `Function`; anything else falls back to JSON. */
function describe(body: unknown): { name: string; detail: string; noisy: boolean } {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const nameKey = "action" in obj ? "action" : "Function" in obj ? "Function" : null;
    if (nameKey) {
      const name = String(obj[nameKey]);
      const rest: Record<string, unknown> = { ...obj };
      delete rest[nameKey];
      let detail = Object.keys(rest).length ? JSON.stringify(rest) : "";
      if (detail.length > 160) detail = detail.slice(0, 157) + "…";
      return { name, detail, noisy: NOISY.test(name) };
    }
  }
  const detail = typeof body === "string" ? body : JSON.stringify(body);
  return { name: "command", detail, noisy: false };
}

/**
 * POST a kind-specific command body to a registered connection.
 * `id` may be null while the caller is still resolving the target —
 * commands sent in that state resolve with `{ ok: false, error }` so
 * call sites don't have to guard manually.
 */
export function useConnectionCommand(id: string | null) {
  return useCallback(
    async <T = unknown>(body: unknown): Promise<CommandResult<T>> => {
      const { name, detail, noisy } = describe(body);
      const tag = detail ? `${name} ${detail}` : name;
      if (!id) {
        log.warn(`${tag} — no connection selected`);
        return { ok: false, error: "No connection selected" };
      }
      try {
        const res = await fetch(
          `/api/connections/${encodeURIComponent(id)}/command`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        const json = (await res.json()) as
          | { ok: true; data: T }
          | { ok: false; error: string };
        if (!res.ok || !json.ok) {
          const msg = "error" in json ? json.error : `HTTP ${res.status}`;
          log.warn(`${tag} ✗ ${msg}`);
          return { ok: false, error: msg };
        }
        // Discrete actions at INFO; fader/scrub/read spam at DEBUG.
        if (noisy) log.debug(`${tag} ✓`);
        else log.info(`${tag} ✓`);
        return { ok: true, data: json.data };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        log.warn(`${tag} ✗ ${msg}`);
        return { ok: false, error: msg };
      }
    },
    [id]
  );
}

/**
 * Resolve the id of the connection a legacy single-instance page should
 * talk to for a given kind. Prefers the operator-chosen DEFAULT
 * connection (the star in the connections panel / `defaults[kind]`) when
 * it's still a valid enabled connection, falling back to the first
 * enabled one. This is what makes EVERY vMix page (live, audio, replay,
 * playlist, titles, colorimetry) — and OBS/Ableton — target the same
 * instance the deck + "default" treat as canonical, instead of whichever
 * connection happens to be first in the list.
 *
 * Returns null while the connections list hasn't loaded or no match
 * exists.
 */
export function useConnectionId(
  connections: Array<{ id: string; kind: string; enabled: boolean }> | null,
  kind: string,
  defaults?: Record<string, string> | null
): string | null {
  if (!connections) return null;
  const def = defaults?.[kind];
  if (def) {
    const chosen = connections.find(
      (c) => c.id === def && c.enabled && c.kind === kind
    );
    if (chosen) return chosen.id;
  }
  const match = connections.find((c) => c.enabled && c.kind === kind);
  return match?.id ?? null;
}
