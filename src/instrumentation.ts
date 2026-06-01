/**
 * Next.js startup hook — runs ONCE when the server process boots, before any
 * request is served.
 *
 * Why this exists: the whole device runtime (per-connection brokers, the
 * Stream Deck press dispatcher, the feedback coordinator) is started by
 * `ensureBooted()`, which used to be called ONLY from API route handlers. So
 * on a fresh server start nothing ran until a client hit a route — i.e. a
 * plugged-in deck rendered its last page but its keys did NOTHING until you
 * opened the web UI. Booting here makes the surface work fully headless: the
 * deck responds to presses and its feedback is live the moment the server is
 * up, with no browser open.
 *
 * `ensureBooted()` is idempotent, so the later route-level calls are no-ops.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime can touch HID / sockets / the filesystem.
  // Skip the Edge instrumentation pass (it has none of that).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureBooted } = await import("@/lib/core/boot");
  ensureBooted();
}
