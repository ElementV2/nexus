import { NextRequest, NextResponse } from "next/server";
import { connectionManager } from "@/lib/core/connection-manager";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Forward a kind-specific command body to the connection's broker.
 * The body shape is whatever the kind expects — vMix uses
 * `{ Function, Input, Value, ... }`, OBS uses `{ action, ... }`, etc.
 * This route does no schema validation: a malformed body is the
 * broker's problem to reject.
 *
 * Errors thrown by the broker surface as 502 with the message body
 * so the client can show a useful toast.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  ensureBooted();
  const { id } = await ctx.params;
  const connection = connectionManager.get(id);
  if (!connection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const data = await connection.broker.send(body);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Command failed",
      },
      { status: 502 }
    );
  }
}
