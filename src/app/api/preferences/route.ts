import { NextRequest, NextResponse } from "next/server";
import {
  getPreferences,
  setPreferences,
  redactPreferences,
  restoreConfigSecrets,
  type AppPreferences,
} from "@/lib/db/preferences";
import { ensureBooted, reconcileFromPreferences } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

export async function GET() {
  // Never ship stored secrets (OBS / grandMA2 password) to the client.
  return NextResponse.json(redactPreferences(getPreferences()));
}

/**
 * Update preferences. The registry `connections` are the single source of
 * truth (the old flat `*_host` mirror fields are gone). A `connections` write
 * reconciles the live brokers so a host/port/password change takes effect
 * immediately.
 */
export async function PUT(request: NextRequest) {
  ensureBooted();
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Restore any redacted secret sentinels echoed back in a connections write
  // to their stored value (the editor round-trips `••••••••` when untouched).
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

  const updated = setPreferences(body as Partial<AppPreferences>);
  // A `connections` write changes the broker set → reconcile so the live
  // brokers match the just-persisted list immediately (no stale-config window).
  if (Array.isArray(body.connections)) reconcileFromPreferences();
  return NextResponse.json(redactPreferences(updated));
}
