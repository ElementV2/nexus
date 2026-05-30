import { NextResponse } from "next/server";
import { satelliteRegistry } from "@/lib/streamdeck/satellite-registry";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Snapshot of all connected satellites. The Stream Deck editor reads
 * this to label remote decks with their host label and show staleness
 * (`lastSeenTs`) so an operator can tell at a glance which satellite
 * is alive vs idle.
 */
export async function GET() {
  ensureBooted();
  return NextResponse.json({ satellites: satelliteRegistry.list() });
}
