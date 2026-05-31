import { NextRequest } from "next/server";
import { variableBus } from "@/lib/core/variable-bus";
import { ensureBooted } from "@/lib/core/boot";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";

/**
 * Live SSE feed of variable changes. On subscribe we replay the full
 * current snapshot as a single `__hydrate` event so the consumer
 * doesn't have to also hit `/api/variables` to bootstrap, then push
 * one `change` event per `variableBus.set()` call.
 */
export async function GET(_req: NextRequest) {
  ensureBooted();
  return sseResponse({
    start(h) {
      h.send({ type: "__hydrate", entries: variableBus.snapshot() });
      return variableBus.subscribe((entry) =>
        h.send({ type: "change", ...entry })
      );
    },
  });
}
