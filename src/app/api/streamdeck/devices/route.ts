import { NextResponse } from "next/server";
import { streamdeckDriver } from "@/lib/streamdeck/driver";
import { peekPreferences } from "@/lib/db/preferences";

export const dynamic = "force-dynamic";

/**
 * Lists every Stream Deck currently plugged in plus the driver
 * status. Status is the single source of truth for the UI to decide
 * whether to enable the "Push to deck" affordance.
 *
 * Merges the operator-assigned friendly name (keyed by serial / ScreenDeck
 * id) onto each device so the load picker + device manager can show
 * "FOH XL" instead of an opaque serial.
 */
export async function GET() {
  const [status, devices] = await Promise.all([
    streamdeckDriver.status(),
    streamdeckDriver.listDevices(),
  ]);
  const names = peekPreferences().deviceNames;
  const named = devices.map((d) =>
    d.serialNumber && names[d.serialNumber]
      ? { ...d, name: names[d.serialNumber] }
      : d
  );
  return NextResponse.json({ status, devices: named });
}
