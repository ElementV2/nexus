import { NextRequest } from "next/server";
import { satelliteRegistry } from "@/lib/streamdeck/satellite-registry";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * SSE channel a satellite subscribes to. The server pushes render /
 * clear / brightness commands targeting its decks. The satellite
 * applies each message to the matching local HID handle.
 *
 * Query string: `?id=<satelliteId>` — must match the id the
 * satellite used in `/announce`. We keep the route stateless and
 * trust the satellite to pick its own stable id (typically the
 * machine hostname + a process suffix).
 *
 * Keepalive ping every 25 s prevents intermediate proxies from
 * dropping the stream. Closing the SSE detaches the writer; the
 * satellite reconnects automatically on its end.
 */
export async function GET(req: NextRequest) {
  ensureBooted();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return new Response(JSON.stringify({ error: "id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let detach: (() => void) | null = null;
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
        detach?.();
        detach = null;
      };

      safeEnqueue(": connected\n\n");

      // Attach the writer — the registry flushes any buffered
      // messages immediately and follows up with a `hello`.
      detach = satelliteRegistry.attachWriter(id, (msg) => {
        safeEnqueue(`data: ${JSON.stringify(msg)}\n\n`);
      });

      heartbeat = setInterval(() => {
        satelliteRegistry.touch(id);
        safeEnqueue(": ping\n\n");
      }, 25_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      detach?.();
      detach = null;
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
