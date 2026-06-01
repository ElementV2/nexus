import { NextRequest } from "next/server";
import { connectionManager } from "@/lib/core/connection-manager";
import { ensureBooted } from "@/lib/core/boot";
import { sseResponse, type SseHandle } from "@/lib/sse";

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

  // Re-hydrate after a backpressure drop (audit N5): a slow client that lost
  // a discrete event (scene-changed, replay-saved…) gets the full snapshot +
  // status again on the next successful frame, instead of staying desynced.
  const hydrate = (h: SseHandle) => {
    h.send({ type: "__status", status: connection.broker.getStatus() });
    const snapshot = connection.broker.getSnapshot();
    if (snapshot !== null && snapshot !== undefined) {
      h.send({ type: "__snapshot", payload: snapshot });
    }
  };

  return sseResponse({
    resync: hydrate,
    start(h) {
      // Hydrate the new subscriber with what we already know — current
      // status + last cached snapshot — before live events arrive.
      hydrate(h);
      return connection.broker.subscribe((event) => h.send(event));
    },
  });
}
