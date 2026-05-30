import { NextRequest, NextResponse } from "next/server";
import {
  satelliteRegistry,
  type SatelliteDevice,
} from "@/lib/streamdeck/satellite-registry";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Satellite-side handshake. The agent POSTs its identity + device
 * list whenever its HID enumeration changes (boot, hotplug). The
 * server upserts the entry and updates serial → satellite ownership
 * — the existing layout/binding lookups by `deviceSerial` then
 * route renders to this satellite automatically.
 *
 * Body:
 *   `{ id: string, label?: string, devices: SatelliteDevice[] }`
 */
export async function POST(req: NextRequest) {
  ensureBooted();
  let body: {
    id?: unknown;
    label?: unknown;
    devices?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (!Array.isArray(body.devices)) {
    return NextResponse.json(
      { error: "devices must be an array" },
      { status: 400 }
    );
  }
  const cleaned: SatelliteDevice[] = [];
  for (const raw of body.devices) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.serial !== "string" || !r.serial) continue;
    cleaned.push({
      serial: r.serial,
      model: typeof r.model === "string" ? r.model : "unknown",
      rows: typeof r.rows === "number" ? r.rows : 0,
      cols: typeof r.cols === "number" ? r.cols : 0,
      iconSize: typeof r.iconSize === "number" ? r.iconSize : 72,
      productName:
        typeof r.productName === "string" ? r.productName : undefined,
    });
  }
  const remoteAddr =
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    undefined;
  satelliteRegistry.announce(
    body.id,
    typeof body.label === "string" ? body.label : undefined,
    cleaned,
    remoteAddr ?? undefined
  );

  // A satellite (re)announcing means its decks may have just appeared
  // (boot, hotplug, reconnect after a restart) and are showing blank
  // keys. The driver's change-detection would otherwise SKIP re-sending
  // an unchanged face — so first drop its cached faces for these
  // serials, THEN re-render every paired layout with current feedback
  // state. Fire-and-forget — the response shouldn't block on HID/SSE.
  void import("@/lib/streamdeck/driver")
    .then(({ streamdeckDriver }) => {
      for (const d of cleaned) streamdeckDriver.invalidateSatellite(d.serial);
      // Tell open browser editors a deck (dis)appeared so their device
      // list refreshes live — otherwise the satellite's decks only show
      // up on a manual refresh / reload (the bug where "Load to deck"
      // said "No Stream Deck" even though the satellite was connected).
      streamdeckDriver.notifyDevicesChanged();
      return import("@/lib/streamdeck/feedback-coordinator");
    })
    .then((m) => m.feedbackCoordinator.refresh())
    .catch(() => {
      /* coordinator not booted yet / no devices — nothing to push */
    });

  return NextResponse.json({ ok: true, accepted: cleaned.length });
}
