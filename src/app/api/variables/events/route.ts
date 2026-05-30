import { NextRequest } from "next/server";
import { variableBus } from "@/lib/core/variable-bus";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Live SSE feed of variable changes. On subscribe we replay the full
 * current snapshot as a single `__hydrate` event so the consumer
 * doesn't have to also hit `/api/variables` to bootstrap, then push
 * one `change` event per `variableBus.set()` call.
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
      safeEnqueue(
        `data: ${JSON.stringify({
          type: "__hydrate",
          entries: variableBus.snapshot(),
        })}\n\n`
      );

      unsubscribe = variableBus.subscribe((entry) => {
        safeEnqueue(
          `data: ${JSON.stringify({ type: "change", ...entry })}\n\n`
        );
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
