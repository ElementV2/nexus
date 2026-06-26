import { NextRequest } from "next/server";
import { ensureBooted } from "@/lib/core/boot";
import { sseResponse } from "@/lib/sse";
import { autoSwitchEngine } from "@/lib/auto-switch/engine";

export const dynamic = "force-dynamic";

/**
 * SSE stream of the auto-réa engine state (running flag, current shot +
 * reason, per-source VU/talking dots, countdown to the next wide). The engine
 * is the single source of truth — this route only forwards, and emits the
 * current state immediately so a late joiner is in sync.
 */
export async function GET(_req: NextRequest) {
  ensureBooted();
  autoSwitchEngine.init();
  return sseResponse({
    start: (h) => {
      h.send(autoSwitchEngine.getState());
      return autoSwitchEngine.subscribe((state) => h.send(state));
    },
    resync: (h) => h.send(autoSwitchEngine.getState()),
  });
}
