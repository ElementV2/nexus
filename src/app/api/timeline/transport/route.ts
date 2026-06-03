import { NextRequest, NextResponse } from "next/server";
import { ensureBooted } from "@/lib/core/boot";
import { sseResponse } from "@/lib/sse";
import { timelineEngine } from "@/lib/timeline/engine";

export const dynamic = "force-dynamic";

/**
 * SSE stream of the playback head + transport state. Every connected
 * client (editor tab, satellite monitor…) gets the same frames so they
 * all show ONE playhead — the engine is the single source of truth, this
 * route only forwards. Emits the current state immediately on connect so a
 * late joiner is in sync.
 */
export async function GET(_req: NextRequest) {
  ensureBooted();
  return sseResponse({
    start: (h) => {
      h.send(timelineEngine.getState());
      return timelineEngine.subscribe((state) => h.send(state));
    },
    // On a dropped frame, re-hydrate with the full current state.
    resync: (h) => h.send(timelineEngine.getState()),
  });
}

/**
 * Transport commands. Body: `{ action, scenarioId?, ms?, skipWaits? }`.
 * The browser only ever sends these — it never advances time itself.
 */
export async function POST(req: NextRequest) {
  ensureBooted();
  let body: {
    action?: string;
    scenarioId?: string;
    ms?: number;
    skipWaits?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  switch (body.action) {
    case "play":
      if (!body.scenarioId) {
        return NextResponse.json(
          { error: "scenarioId required for play" },
          { status: 400 }
        );
      }
      return NextResponse.json({
        ok: true,
        state: timelineEngine.play(body.scenarioId, { skipWaits: body.skipWaits }),
      });
    case "pause":
      return NextResponse.json({ ok: true, state: timelineEngine.pause() });
    case "resume":
      return NextResponse.json({ ok: true, state: timelineEngine.resume() });
    case "stop":
      return NextResponse.json({ ok: true, state: timelineEngine.stop() });
    case "seek":
      return NextResponse.json({
        ok: true,
        state: timelineEngine.seek(Number(body.ms) || 0, body.scenarioId),
      });
    case "go":
      return NextResponse.json({ ok: true, state: timelineEngine.go() });
    case "setSkipWaits":
      return NextResponse.json({
        ok: true,
        state: timelineEngine.setSkipWaits(!!body.skipWaits),
      });
    default:
      return NextResponse.json(
        { error: `Unknown action "${body.action}"` },
        { status: 400 }
      );
  }
}
