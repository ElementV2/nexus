import { stateBroker } from "@/lib/vmix/state-broker";

export const dynamic = "force-dynamic";

/**
 * SSE stream of vMix state. Replaces per-client polling — the server
 * holds a single poller against vMix and fans out updates to every
 * connected client.
 */
export async function GET() {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Helps proxies / browsers know the stream is alive.
      controller.enqueue(encoder.encode(": connected\n\n"));

      unsubscribe = stateBroker.subscribe((msg) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(msg)}\n\n`)
          );
        } catch {
          // controller may already be closed if the client went away
          unsubscribe?.();
          unsubscribe = null;
        }
      });

      // Keep-alive comment every 25 s to prevent intermediaries from
      // dropping the connection (Next dev hot-reload, mobile NATs, etc.).
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // Client dropped — some runtimes skip cancel() on abrupt TCP
          // drops, so clean up here too. Otherwise the broker keeps a
          // ghost subscriber and the heartbeat fires forever.
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
