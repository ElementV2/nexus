import { NextResponse } from "next/server";
import { streamdeckDriver } from "@/lib/streamdeck/driver";

export const dynamic = "force-dynamic";

/**
 * Lists every Stream Deck currently plugged in plus the driver
 * status. Status is the single source of truth for the UI to decide
 * whether to enable the "Push to deck" affordance.
 */
export async function GET() {
  const [status, devices] = await Promise.all([
    streamdeckDriver.status(),
    streamdeckDriver.listDevices(),
  ]);
  return NextResponse.json({ status, devices });
}
