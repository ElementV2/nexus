import { NextRequest, NextResponse } from "next/server";
import { satelliteRegistry } from "@/lib/streamdeck/satellite-registry";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * A satellite POSTs key events here. They funnel into the same
 * driver subscribe channel as locally-attached decks, so the
 * server-side press dispatcher fires the bound preset without
 * caring whether the device was local or remote.
 *
 * Body: `{ id: string, serial: string, keyIndex: number, type: "down" | "up" }`
 */
export async function POST(req: NextRequest) {
  ensureBooted();
  let body: {
    id?: unknown;
    serial?: unknown;
    keyIndex?: unknown;
    type?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (typeof body.serial !== "string" || !body.serial) {
    return NextResponse.json({ error: "serial required" }, { status: 400 });
  }
  if (typeof body.keyIndex !== "number" || !Number.isFinite(body.keyIndex)) {
    return NextResponse.json(
      { error: "keyIndex must be a number" },
      { status: 400 }
    );
  }
  // Ownership check: only the satellite that ANNOUNCED this serial may
  // fire its presses. Without this any LAN host could POST a press for a
  // known serial and trigger real vMix/OBS commands.
  if (satelliteRegistry.ownerOf(body.serial) !== body.id) {
    return NextResponse.json(
      { error: "serial not owned by this satellite" },
      { status: 403 }
    );
  }
  const type = body.type === "up" ? "up" : "down";
  satelliteRegistry.receivePress({
    serial: body.serial,
    keyIndex: body.keyIndex,
    type,
  });
  return NextResponse.json({ ok: true });
}
