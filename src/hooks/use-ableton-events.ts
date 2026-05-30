"use client";

import { useCallback } from "react";
import { useAbletonStore } from "@/stores/ableton-store";
import { useConnections } from "./use-connections";
import { useConnectionEvents } from "./use-connection-events";
import { useConnectionId } from "./use-connection-command";
import type { AbletonEvent } from "@/lib/ableton/types";

/**
 * Subscribe to the AbletonOSC broker via the generic connection events
 * stream. Same dispatch shape as the legacy hook; only the SSE URL
 * changed.
 *
 * Meta envelopes (`__status`, `__snapshot`) from the connection
 * manager are skipped — the broker's own status/snapshot replay on
 * subscribe carries the richer payloads the store expects.
 */
export function useAbletonEvents() {
  const setStatus = useAbletonStore((s) => s.setStatus);
  const setSnapshot = useAbletonStore((s) => s.setSnapshot);
  const setPlayingSlot = useAbletonStore((s) => s.setPlayingSlot);
  const applyTransportPatch = useAbletonStore((s) => s.applyTransportPatch);
  const setClipPosition = useAbletonStore((s) => s.setClipPosition);

  const { data: connectionsData } = useConnections();
  const abletonId = useConnectionId(
    connectionsData?.connections ?? null,
    "ableton",
    connectionsData?.defaults
  );

  const onMessage = useCallback(
    (e: MessageEvent) => {
      let event: AbletonEvent | { type: string };
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event.type === "__status" || event.type === "__snapshot") return;
      const ev = event as AbletonEvent;
      switch (ev.type) {
        case "status":
          setStatus(ev.status, ev.host, ev.port, ev.version, ev.error);
          break;
        case "snapshot":
          setSnapshot(ev.snapshot);
          break;
        case "playing-slot":
          setPlayingSlot(ev.trackIndex, ev.playingSlotIndex);
          break;
        case "transport":
          applyTransportPatch(ev.patch);
          break;
        case "clip-position":
          setClipPosition({
            trackIndex: ev.trackIndex,
            clipIndex: ev.clipIndex,
            position: ev.position,
            ts: ev.ts,
          });
          break;
      }
    },
    [
      setStatus,
      setSnapshot,
      setPlayingSlot,
      applyTransportPatch,
      setClipPosition,
    ]
  );

  useConnectionEvents(abletonId, onMessage);
}
