import { NextRequest, NextResponse } from "next/server";
import {
  addConnection,
  getPreferences,
  updateConnection,
  redactConfigSecrets,
  restoreConfigSecrets,
  redactPreferences,
} from "@/lib/db/preferences";
import { connectionManager } from "@/lib/core/connection-manager";
import { ensureBooted, reconcileFromPreferences } from "@/lib/core/boot";
import { listKinds, validateConfig } from "@/lib/core/registry";

export const dynamic = "force-dynamic";

/**
 * List all configured connections plus their live status. Returns
 * everything the connections UI needs to render in one round-trip —
 * the persisted config (host/port/etc.) alongside the broker's
 * current status (offline / connecting / connected / error).
 *
 * If the broker map hasn't been populated yet this call boots it.
 */
export async function GET() {
  ensureBooted();
  const prefs = getPreferences();
  const items = prefs.connections.map((c) => {
    const live = connectionManager.get(c.id);
    return {
      ...c,
      // Redact per-instance secrets (OBS / grandMA2 password) before they
      // cross to the browser; the editor round-trips the sentinel on save.
      config: redactConfigSecrets(c.config),
      status: live?.broker.getStatus() ?? "offline",
    };
  });
  // Surface the registered kinds too so the "Add connection" UI doesn't
  // need a separate request. Each kind reports its display name and
  // default config blob to seed the new-card form.
  const kinds = listKinds().map((k) => ({
    kind: k.kind,
    displayName: k.displayName,
    tagline: k.tagline,
    defaultConfig: k.defaultConfig(),
    pages: k.pages?.map((p) => ({ href: p.href, label: p.label })),
  }));
  // The default connection per kind. Surfaces (Stream Deck) and the
  // connections panel read this to show which instance is the one the
  // single-instance pages drive and un-pinned actions resolve to.
  return NextResponse.json({
    connections: items,
    kinds,
    defaults: prefs.defaultConnections ?? {},
  });
}

/**
 * Create a new connection. Body: `{ kind, label?, config? }`. The
 * kind's `parseConfig` validates `config` (falling back to its
 * defaultConfig on omission); on success the entry is persisted and
 * the manager reconciles to spin the broker up immediately.
 */
export async function POST(request: NextRequest) {
  ensureBooted();
  let body: { kind?: unknown; label?: unknown; config?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.kind !== "string" || !body.kind) {
    return NextResponse.json({ error: "kind required" }, { status: 400 });
  }
  const kinds = listKinds();
  const kind = kinds.find((k) => k.kind === body.kind);
  if (!kind) {
    return NextResponse.json(
      { error: `Unknown kind "${body.kind}"` },
      { status: 400 }
    );
  }
  // Creation has no prior secret to preserve — collapse any sentinel the
  // client echoed back to empty so it's never stored literally.
  const rawConfig = restoreConfigSecrets(body.config ?? kind.defaultConfig(), {});
  const parsed = validateConfig(kind.kind, rawConfig);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : kind.displayName;
  const { id } = addConnection(kind.kind, label, parsed.config);
  reconcileFromPreferences();
  return NextResponse.json({ id }, { status: 201 });
}

/**
 * Bulk update — used by the connections panel "save all" path or by
 * the legacy preferences screen reflecting back into the registry.
 * Single-entry updates should go through `/api/connections/[id]`.
 */
export async function PUT(request: NextRequest) {
  ensureBooted();
  let body: { id?: unknown; patch?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (!body.patch || typeof body.patch !== "object") {
    return NextResponse.json({ error: "patch required" }, { status: 400 });
  }
  const patch = body.patch as Parameters<typeof updateConnection>[1];
  // Restore any redacted secret in the patched config from the stored
  // value so a host/port-only edit doesn't blank the password, THEN
  // validate it against the kind's schema before persisting. Without the
  // validation an invalid blob lands in preferences.json and later makes
  // `connectionManager.reconcile` -> `kind.make()` throw (the single-entry
  // PUT already validates; this bulk path used to skip it).
  if (patch.config !== undefined) {
    const existing = getPreferences().connections.find((c) => c.id === body.id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    patch.config = restoreConfigSecrets(patch.config, existing.config);
    const parsed = validateConfig(existing.kind, patch.config);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    patch.config = parsed.config;
  }
  const updated = updateConnection(body.id, patch);
  reconcileFromPreferences();
  // Redact secrets in the echoed prefs (same rule as the GET paths).
  return NextResponse.json({ ok: true, prefs: redactPreferences(updated) });
}
