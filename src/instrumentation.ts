/**
 * Next.js startup hook — boots the device runtime so a plugged-in Stream
 * Deck responds to presses and shows its last page WITHOUT anyone opening
 * the web UI.
 *
 * IMPORTANT — why this does NOT import the app:
 * Next compiles instrumentation in a SEPARATE module context from the route
 * handlers. An earlier version imported `@/lib/core/boot` directly and called
 * ensureBooted() here — which built the connection manager / broker
 * singletons in THIS context, distinct from the ones routes use. The first
 * API request then got a fresh, EMPTY manager (and a shared globalThis
 * "booted" flag blocked re-reconcile), so /api/connections/<id>/events 404'd.
 *
 * The fix: don't touch app modules. Just fire ONE HTTP request at our own
 * server once it's listening. That goes through the normal route handler, so
 * ensureBooted() runs in the ROUTE context — the only place the singletons
 * live — starting the broker reconcile, the press dispatcher, and the
 * feedback coordinator (which paints each deck's last page). No duplication.
 *
 * Fire-and-forget with retries: register() must return for the server to
 * start listening, and in dev the route compiles on its first hit.
 */
export function register(): void {
  // HID / sockets / self-fetch only make sense on the Node server runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  void warmUp();
}

async function warmUp(): Promise<void> {
  // The server binds to HOSTNAME:PORT (passed by the launcher). When it binds
  // 0.0.0.0 (all interfaces) loopback reaches it; when it binds a specific IP
  // we must target that exact address.
  const host =
    process.env.HOSTNAME && process.env.HOSTNAME !== "0.0.0.0"
      ? process.env.HOSTNAME
      : "127.0.0.1";
  const port = process.env.PORT || "3000";
  const url = `http://${host}:${port}/api/connections`;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return; // ensureBooted ran in the route context — done
    } catch {
      /* server not listening yet / route still compiling — retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
