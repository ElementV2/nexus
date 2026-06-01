"use client";

import { useCallback } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { useConnections } from "./use-connections";
import { useConnectionEvents } from "./use-connection-events";
import { useConnectionId } from "./use-connection-command";
import type { VmixState } from "@/lib/vmix/types";

/**
 * Subscribe to the vMix state-broker via the generic connection events
 * stream. The kind adapter wraps each broker message as
 * `{ type: "state", ok, state?, error?, ts }` so we dispatch on the
 * discriminator the same way every other kind's hook does. (The raw XML
 * is no longer shipped over SSE — its only consumer, the debug page, was
 * removed; see audit N11.)
 *
 * Meta envelopes (`__status`, `__snapshot`) emitted by the connection
 * manager are ignored — the broker's own subscribe-replay covers the
 * initial hydration with richer payloads.
 */

type StateEvent =
  | { type: "state"; ok: true; state: VmixState; ts: number }
  | { type: "state"; ok: false; error: string; ts: number };

export function useVmixEvents() {
  const setVmixState = useVmixStore((s) => s.setVmixState);
  const setConnected = useVmixStore((s) => s.setConnected);
  const setError = useVmixStore((s) => s.setError);

  const { data: connectionsData } = useConnections();
  const vmixId = useConnectionId(
    connectionsData?.connections ?? null,
    "vmix",
    connectionsData?.defaults
  );

  const onMessage = useCallback(
    (e: MessageEvent) => {
      let event: { type: string } & Record<string, unknown>;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event.type !== "state") return;
      const ev = event as StateEvent;
      if (ev.ok) {
        setVmixState(ev.state);
        setConnected(true);
      } else {
        setError(ev.error);
      }
    },
    [setVmixState, setConnected, setError]
  );

  useConnectionEvents(vmixId, onMessage);
}
