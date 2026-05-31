import { NextRequest } from "next/server";
import { satelliteRegistry } from "@/lib/streamdeck/satellite-registry";
import { ensureBooted } from "@/lib/core/boot";
import { sseResponse } from "@/lib/sse";

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

  return sseResponse({
    // Keep the satellite alive in the registry on every keepalive tick.
    onHeartbeat: () => satelliteRegistry.touch(id),
    start(h) {
      // Attach the writer — the registry flushes any buffered messages
      // immediately and follows up with a `hello`.
      const detach = satelliteRegistry.attachWriter(id, (msg) => h.send(msg));
      return () => {
        detach();
        // SSE closed → this satellite can no longer be driven. If it didn't
        // immediately reconnect, drop it NOW so its decks disappear from
        // open editors' device lists right away (don't wait ~75 s for the
        // stale-reaper). `removeIfDisconnected` no-ops if a newer SSE
        // already re-attached, so a transient blip + reconnect is safe.
        if (satelliteRegistry.removeIfDisconnected(id)) {
          void import("@/lib/streamdeck/driver").then(({ streamdeckDriver }) =>
            streamdeckDriver.notifyDevicesChanged()
          );
        }
      };
    },
  });
}
