import { NextRequest } from "next/server";
import { streamdeckDriver } from "@/lib/streamdeck/driver";
import { ensureBooted } from "@/lib/core/boot";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";

/**
 * SSE stream of HID events — forwarding only. Each connected client gets
 * a copy of every event the driver emits so the editor UI can react
 * (hotplug refetches, key-press visual pulse, error toasts).
 *
 * Critical: this route is NOT the place to execute key presses. That
 * happens in `src/lib/streamdeck/press-dispatcher.ts` — a single
 * server-side subscriber that runs the bound preset once per physical
 * press regardless of how many SSE consumers are connected. Folding the
 * dispatch into this per-client handler caused 1× press to fire the
 * preset N times when N tabs were open.
 *
 * Uses the shared `sseResponse` helper so it gets the same backpressure
 * guard + heartbeat + teardown as every other SSE route.
 */
export async function GET(_req: NextRequest) {
  ensureBooted();
  return sseResponse({
    start: (h) => streamdeckDriver.subscribe((event) => h.send(event)),
  });
}
