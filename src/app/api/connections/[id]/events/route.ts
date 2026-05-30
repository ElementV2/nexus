import { NextRequest } from "next/server";
import { connectionManager } from "@/lib/core/connection-manager";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * SSE stream of one connection's events. Generic replacement for the
 * per-kind event routes (`/api/vmix/events`, `/api/obs/events`, ...).
 * The route is kind-agnostic — it just forwards whatever the broker
 * emits. Each event also carries the connection id so a client
 * subscribed to multiple connections can route the message itself.
 *
 * On subscribe we also push:
 *   - a synthetic `__status` event with the current broker status,
 *   - a `__snapshot` if one is cached,
 * so the first paint doesn't have to wait for the broker's next tick.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  ensureBooted();
  const { id } = await ctx.params;
  const connection = connectionManager.get(id);
  if (!connection) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

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
          // Controller closed (client disconnected mid-write). Clean up
          // so the broker doesn't keep a ghost subscriber driving a
          // dead controller for 25 s until the heartbeat notices.
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

      // Hydrate the new subscriber with what we already know — current
      // status + last cached snapshot. The broker will follow up with
      // its own events from `subscribe()` shortly.
      safeEnqueue(
        `data: ${JSON.stringify({
          type: "__status",
          status: connection.broker.getStatus(),
        })}\n\n`
      );
      const snapshot = connection.broker.getSnapshot();
      if (snapshot !== null && snapshot !== undefined) {
        safeEnqueue(
          `data: ${JSON.stringify({
            type: "__snapshot",
            payload: snapshot,
          })}\n\n`
        );
      }

      unsubscribe = connection.broker.subscribe((event) => {
        safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
      });

      heartbeat = setInterval(() => {
        safeEnqueue(": ping\n\n");
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
