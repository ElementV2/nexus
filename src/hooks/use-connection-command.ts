"use client";

import { useCallback } from "react";

/**
 * Result envelope shared by every kind. Mirrors the legacy
 * `useObsCommand` / `useVmixCommand` returns so callers don't have to
 * special-case generic vs. legacy hooks during the migration window.
 */
export type CommandResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * POST a kind-specific command body to a registered connection.
 * `id` may be null while the caller is still resolving the target —
 * commands sent in that state resolve with `{ ok: false, error }` so
 * call sites don't have to guard manually.
 */
export function useConnectionCommand(id: string | null) {
  return useCallback(
    async <T = unknown>(body: unknown): Promise<CommandResult<T>> => {
      if (!id) {
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
          return { ok: false, error: msg };
        }
        return { ok: true, data: json.data };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Network error",
        };
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
