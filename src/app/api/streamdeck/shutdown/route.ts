import { NextResponse } from "next/server";
import { streamdeckDriver } from "@/lib/streamdeck/driver";

export const dynamic = "force-dynamic";

/**
 * Reset every connected Stream Deck to its firmware standby logo and release
 * the handles. The launcher calls this just BEFORE force-killing the server
 * process (Windows `taskkill /F` gives the process no graceful-signal
 * window, so a SIGTERM handler can't be relied on there). Keeping the reset
 * here — server-side, where the HID handles actually live — means a closed
 * server leaves the decks on the idle logo instead of stale, dead buttons.
 *
 * Best-effort and idempotent: safe to call when no deck is connected.
 */
export async function POST() {
  try {
    await streamdeckDriver.resetAll();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "reset failed" },
      { status: 500 }
    );
  }
}
