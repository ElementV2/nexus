/**
 * Shared Server-Sent-Events scaffolding for route handlers.
 *
 * Every SSE route (`/api/connections/:id/events`, `/api/variables/events`,
 * `/api/streamdeck/satellite/events`) used to hand-roll the same
 * controller + heartbeat + backpressure + cleanup boilerplate — and a fix
 * to one (e.g. adding the backpressure guard) had to be copy-pasted to the
 * others. This centralises it: a route just declares what to push on open
 * and returns a teardown.
 *
 * Behaviour preserved from the originals:
 *   • emits `: connected` immediately,
 *   • drops frames when the client buffer is saturated (`desiredSize<=0`)
 *     instead of growing server memory — state self-heals on the next
 *     event, heartbeats are disposable,
 *   • 25 s keepalive `: ping` (interval configurable),
 *   • runs the teardown exactly once on client disconnect / enqueue
 *     failure / stream cancel.
 */

/** Writer handed to the `start` callback. All writes are backpressure-
 *  guarded and no-op after the stream closes; they return `false` when
 *  the frame was dropped or the stream is gone. */
export interface SseHandle {
  /** Send a `data:` frame (the value is JSON-encoded). */
  send(data: unknown): boolean;
  /** Send a raw SSE comment line (`: <text>`), e.g. a keepalive. */
  comment(text: string): boolean;
}

export interface SseInit {
  /**
   * Called once when the stream opens. Push initial frames here and wire
   * any subscription. Return a teardown callback (unsubscribe / detach);
   * it runs exactly once when the client disconnects.
   */
  start: (h: SseHandle) => (() => void) | void;
  /** Keepalive cadence in ms. Default 25 000. */
  heartbeatMs?: number;
  /** Side-effect to run on each heartbeat tick BEFORE the ping is sent
   *  (e.g. the satellite registry `touch(id)` liveness bump). */
  onHeartbeat?: () => void;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export function sseResponse(init: SseInit): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let teardown: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          try {
            teardown?.();
          } catch {
            /* teardown must never throw out of cleanup */
          }
          teardown = null;
        };

        const raw = (chunk: string): boolean => {
          if (closed) return false;
          try {
            // Backpressure: drop once the client's 64-frame buffer is
            // saturated (stuck/slow socket) rather than buffering forever.
            if (controller.desiredSize !== null && controller.desiredSize <= 0) {
              return false;
            }
            controller.enqueue(encoder.encode(chunk));
            return true;
          } catch {
            // Controller closed mid-write (client gone) → tear down so the
            // upstream subscription doesn't keep feeding a dead controller.
            cleanup();
            return false;
          }
        };

        const handle: SseHandle = {
          send: (data) => raw(`data: ${JSON.stringify(data)}\n\n`),
          comment: (text) => raw(`: ${text}\n\n`),
        };

        handle.comment("connected");
        const t = init.start(handle);
        teardown = typeof t === "function" ? t : null;

        heartbeat = setInterval(() => {
          init.onHeartbeat?.();
          handle.comment("ping");
        }, init.heartbeatMs ?? 25_000);
      },
      cancel() {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          teardown?.();
        } catch {
          /* ignore */
        }
        teardown = null;
        closed = true;
      },
    },
    new CountQueuingStrategy({ highWaterMark: 64 })
  );

  return new Response(stream, { headers: SSE_HEADERS });
}
