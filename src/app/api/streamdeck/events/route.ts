import { NextRequest } from "next/server";
import { streamdeckDriver } from "@/lib/streamdeck/driver";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * SSE stream of HID events — forwarding only. Each connected client
 * gets a copy of every event the driver emits so the editor UI can
 * react (hotplug refetches, key-press visual pulse, error toasts).
 *
 * Critical: this route is NOT the place to execute key presses. That
 * happens in `src/lib/streamdeck/press-dispatcher.ts` — a single
 * server-side subscriber that runs the bound preset once per physical
 * press regardless of how many SSE consumers are connected. Folding
 * the dispatch into this per-client handler caused 1× press to fire
 * the preset N times when N tabs were open.
 */
export async function GET(_req: NextRequest) {
  ensureBooted();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: string): boolean => {
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };
      const cleanup = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        unsubscribe?.();
        unsubscribe = null;
      };

      safeEnqueue(": connected\n\n");

      unsubscribe = streamdeckDriver.subscribe((event) => {
        // Forward the event verbatim. Preset execution on key-down
        // happens in the press-dispatcher singleton (booted from
        // boot.ts), not here — folding it in here re-fired the
        // preset once per connected SSE client.
        safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
      });

      heartbeat = setInterval(() => safeEnqueue(": ping\n\n"), 25_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
