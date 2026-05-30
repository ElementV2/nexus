import { NextResponse } from "next/server";
import { variableBus } from "@/lib/core/variable-bus";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Snapshot of every published variable across all connections. Format:
 * `[{ connectionId, varId, value, ts }, ...]`. Consumers that want a
 * live feed should subscribe to `/api/variables/events` instead — this
 * endpoint is for one-shot inspections and editor population.
 */
export async function GET() {
  ensureBooted();
  return NextResponse.json({ variables: variableBus.snapshot() });
}
