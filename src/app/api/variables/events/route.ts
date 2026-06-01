import { NextRequest } from "next/server";
import { variableBus, type VariableEntry } from "@/lib/core/variable-bus";
import { ensureBooted } from "@/lib/core/boot";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";

/**
 * Live SSE feed of variable changes. On subscribe we replay the full
 * current snapshot as a single `__hydrate` event so the consumer
 * doesn't have to also hit `/api/variables` to bootstrap, then push
 * changes.
 *
 * Coalescing (audit P-SSE-VAR): a `setBatch` (e.g. a vMix poll publishing
 * ~30 variables) used to emit ~30 separate frames, each `JSON.stringify`'d
 * per client. We buffer the entries of one microtask and emit ONE `changes`
 * frame — one stringify, one client re-render — instead of N.
 */
export async function GET(_req: NextRequest) {
  ensureBooted();
  return sseResponse({
    // After a backpressure drop, re-hydrate the client with the full var set.
    resync(h) {
      h.send({ type: "__hydrate", entries: variableBus.snapshot() });
    },
    start(h) {
      h.send({ type: "__hydrate", entries: variableBus.snapshot() });
      let buffer: VariableEntry[] = [];
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        if (buffer.length === 0) return;
        const entries = buffer;
        buffer = [];
        h.send({ type: "changes", entries });
      };
      return variableBus.subscribe((entry) => {
        buffer.push(entry);
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(flush);
        }
      });
    },
  });
}
