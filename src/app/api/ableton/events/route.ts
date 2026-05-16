import { abletonBroker } from "@/lib/ableton/osc-broker";

export const dynamic = "force-dynamic";

/**
 * SSE stream of AbletonOSC state. Mirrors the vMix events route: the
 * broker keeps a single OSC socket open and fans out events to every
 * connected client.
 */
export async function GET() {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      unsubscribe = abletonBroker.subscribe((event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          unsubscribe?.();
          unsubscribe = null;
        }
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // The browser dropped the SSE connection. Some runtimes
          // don't call cancel() on abrupt TCP drops, so we have to
          // tear down ourselves — otherwise the broker keeps a dead
          // subscriber forever and the heartbeat keeps firing.
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          unsubscribe?.();
          unsubscribe = null;
        }
      }, 25_000);
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
