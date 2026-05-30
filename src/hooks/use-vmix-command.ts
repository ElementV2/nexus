"use client";

import { useCallback } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { useConnections } from "./use-connections";
import {
  useConnectionCommand,
  useConnectionId,
} from "./use-connection-command";
import type { VmixCommand } from "@/lib/vmix/commands";

/**
 * Fire-and-forget vMix command dispatcher. Resolves the first enabled
 * connection of kind="vmix" and POSTs the command via the generic
 * `/api/connections/:id/command` endpoint.
 *
 * Same retry-on-transient-failure shape the legacy `sendCommand`
 * helper had — most "command lost" cases come from a single network
 * blip during reconnection, and one retry is enough to ride it out
 * without the operator noticing.
 */
export function useVmixCommand() {
  const connected = useVmixStore((s) => s.connected);
  const { data: connectionsData } = useConnections();
  const vmixId = useConnectionId(
    connectionsData?.connections ?? null,
    "vmix",
    connectionsData?.defaults
  );
  const sendOnce = useConnectionCommand(vmixId);

  return useCallback(
    async (command: VmixCommand) => {
      if (!connected) return;
      let res = await sendOnce(command);
      if (!res.ok) {
        // Don't retry obvious client errors (the broker's own
        // validation already failed — a second attempt won't help).
        // The legacy heuristic was `(4xx)` in the error message; we
        // keep the same pattern.
        if (!/\b4\d\d\b/.test(res.error)) {
          await new Promise((r) => setTimeout(r, 120));
          res = await sendOnce(command);
        }
      }
      if (!res.ok) {
        console.error("vMix command error:", res.error);
      }
    },
    [connected, sendOnce]
  );
}
