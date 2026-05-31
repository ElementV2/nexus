import { NextRequest, NextResponse } from "next/server";
import {
  getPreferences,
  setPreferences,
  redactPreferences,
  restoreConfigSecrets,
  legacyConfigPatches,
  applyLegacyPatchesToConnections,
  REDACTED_SECRET,
} from "@/lib/db/preferences";
import { ensureBooted, reconcileFromPreferences } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

export async function GET() {
  // Never ship stored secrets (OBS / grandMA2 password) to the client.
  return NextResponse.json(redactPreferences(getPreferences()));
}

/**
 * Update preferences.
 *
 * The legacy flat device fields (`vmix_host`, `obs_*`, `ableton_*`) are a
 * DERIVED mirror of each kind's default connection — the registry
 * connection is the single source of truth. So a legacy-field edit in the
 * body is translated into that connection's config (see
 * `legacyConfigPatches`), then persisted through the registry. Writing the
 * legacy field directly would be silently undone by `applyDefaultsToLegacy`
 * re-mirroring the connection's current value — which is exactly why the
 * Network page's "Connect to vMix/OBS" used to no-op once a connection
 * existed. Routing the edit through the connection fixes that and reconciles
 * the broker so the new host takes effect immediately.
 */
export async function PUT(request: NextRequest) {
  ensureBooted();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Redacted-secret hygiene: a sentinel echoed back from a GET means
  // "unchanged" — strip it so the stored value is preserved.
  if (body.obs_password === REDACTED_SECRET) delete body.obs_password;
  if (Array.isArray(body.connections)) {
    const existingById = new Map(
      getPreferences().connections.map((c) => [c.id, c])
    );
    body.connections = body.connections.map((c) => {
      const entry = c as { id?: unknown; config?: unknown };
      if (typeof entry.id !== "string") return c;
      return {
        ...(entry as Record<string, unknown>),
        config: restoreConfigSecrets(
          entry.config,
          existingById.get(entry.id)?.config
        ),
      };
    });
  }

  // Translate legacy device-field edits → default-connection config edits.
  const patches = legacyConfigPatches(body);

  const updated = setPreferences(body);

  if (Object.keys(patches).length > 0) {
    const connections = applyLegacyPatchesToConnections(
      updated.connections,
      updated.defaultConnections,
      patches
    );
    const synced = setPreferences({ connections });
    // Reconcile so the per-instance broker picks up the new host/port/
    // password immediately (no stale-config window).
    reconcileFromPreferences();
    return NextResponse.json(redactPreferences(synced));
  }

  // A direct `connections` write (bulk save with no legacy device-field
  // edit) still changes the broker set → reconcile so the live brokers
  // match the just-persisted list instead of waiting for another route.
  if (Array.isArray(body.connections)) reconcileFromPreferences();
  return NextResponse.json(redactPreferences(updated));
}
