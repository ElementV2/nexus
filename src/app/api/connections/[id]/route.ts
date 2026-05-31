import { NextRequest, NextResponse } from "next/server";
import {
  getPreferences,
  removeConnection,
  updateConnection,
  redactConfigSecrets,
  restoreConfigSecrets,
  redactPreferences,
} from "@/lib/db/preferences";
import { connectionManager } from "@/lib/core/connection-manager";
import { ensureBooted, reconcileFromPreferences } from "@/lib/core/boot";
import { getKind, validateConfig } from "@/lib/core/registry";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Single-connection inspection. Returns the persisted config plus
 * the broker's live status and (if available) its snapshot. The
 * snapshot is included so pages can render immediately on navigate
 * without waiting for the first SSE tick.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  ensureBooted();
  const { id } = await ctx.params;
  const prefs = getPreferences();
  const cfg = prefs.connections.find((c) => c.id === id);
  if (!cfg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const live = connectionManager.get(id);
  return NextResponse.json({
    ...cfg,
    // Redact secrets (OBS / grandMA2 password) before sending to client.
    config: redactConfigSecrets(cfg.config),
    status: live?.broker.getStatus() ?? "offline",
    snapshot: live?.broker.getSnapshot() ?? null,
  });
}

/**
 * Update an existing connection. Body: `{ label?, enabled?, config? }`.
 * If `config` is present it's re-validated via the kind. Reconciles
 * the manager so any host/port change takes effect without waiting
 * for the next boot.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  ensureBooted();
  const { id } = await ctx.params;
  const prefs = getPreferences();
  const existing = prefs.connections.find((c) => c.id === id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Parameters<typeof updateConnection>[1] = {};
  if (typeof body.label === "string") patch.label = body.label.trim();
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.config !== undefined) {
    const kind = getKind(existing.kind);
    if (!kind) {
      return NextResponse.json(
        { error: `Kind "${existing.kind}" no longer registered` },
        { status: 500 }
      );
    }
    // Swap any redacted secret the editor echoed back for the stored
    // value before validating, so a host/port-only save keeps the
    // password the operator never re-typed.
    const merged = restoreConfigSecrets(body.config, existing.config);
    const parsed = validateConfig(existing.kind, merged);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    patch.config = parsed.config;
  }
  const updated = updateConnection(id, patch);
  reconcileFromPreferences();
  // Redact secrets — the PUT response must not echo the stored password
  // back in cleartext (same rule as the GET paths).
  return NextResponse.json({ ok: true, prefs: redactPreferences(updated) });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  ensureBooted();
  const { id } = await ctx.params;
  removeConnection(id);
  reconcileFromPreferences();
  return NextResponse.json({ ok: true });
}
