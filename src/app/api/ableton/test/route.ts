import { NextResponse } from "next/server";
import { abletonBroker } from "@/lib/ableton/osc-broker";

export const dynamic = "force-dynamic";

/**
 * One-shot connection probe for the "Test connection" button. Uses the
 * currently saved preferences via the broker. If you want to test new
 * host/port values, save them first — the broker rebinds immediately.
 */
export async function POST() {
  const result = await abletonBroker.testConnection();
  if (result.ok) {
    return NextResponse.json({ ok: true, version: result.version });
  }
  return NextResponse.json({ ok: false, error: result.error });
}
