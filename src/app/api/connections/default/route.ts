import { NextRequest, NextResponse } from "next/server";
import { setDefaultConnection, getPreferences } from "@/lib/db/preferences";
import { ensureBooted, reconcileFromPreferences } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Set (or clear) the default connection for a kind.
 *
 * Body: `{ kind: string, connectionId: string | null }`.
 *
 * The default is what un-pinned Stream Deck actions resolve to AND
 * what the legacy single-instance pages (live / playlist / title /
 * colour) drive — setting it mirrors that connection's host/port into
 * the legacy fields (handled in `setDefaultConnection`). We reconcile
 * afterwards so any host change takes effect on the live broker too.
 */
export async function POST(req: NextRequest) {
  ensureBooted();
  let body: { kind?: unknown; connectionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.kind !== "string" || !body.kind) {
    return NextResponse.json({ error: "kind required" }, { status: 400 });
  }
  const connectionId =
    typeof body.connectionId === "string" && body.connectionId
      ? body.connectionId
      : null;
  // Guard: if pinning, the connection must exist and match the kind.
  if (connectionId) {
    const prefs = getPreferences();
    const conn = prefs.connections.find((c) => c.id === connectionId);
    if (!conn || conn.kind !== body.kind) {
      return NextResponse.json(
        { error: `Connection "${connectionId}" is not a ${body.kind}` },
        { status: 400 }
      );
    }
  }
  const prefs = setDefaultConnection(body.kind, connectionId);
  reconcileFromPreferences();
  return NextResponse.json({
    ok: true,
    defaults: prefs.defaultConnections,
  });
}
