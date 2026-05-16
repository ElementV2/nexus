"use client";

import { useCallback } from "react";
import { useAbletonStore } from "@/stores/ableton-store";
import { useSSE } from "./use-sse";
import type { AbletonEvent } from "@/lib/ableton/types";

/**
 * Subscribe to the server-side AbletonOSC broker via SSE. Boilerplate
 * (visibility, retry, cleanup) is shared with `useVmixEvents` through
 * the `useSSE` helper.
 */
export function useAbletonEvents() {
  const setStatus = useAbletonStore((s) => s.setStatus);
  const setSnapshot = useAbletonStore((s) => s.setSnapshot);
  const setPlayingSlot = useAbletonStore((s) => s.setPlayingSlot);
  const applyTransportPatch = useAbletonStore((s) => s.applyTransportPatch);
  const setClipPosition = useAbletonStore((s) => s.setClipPosition);

  const onMessage = useCallback(
    (e: MessageEvent) => {
      let event: AbletonEvent;
      try {
        event = JSON.parse(e.data) as AbletonEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case "status":
          setStatus(
            event.status,
            event.host,
            event.port,
            event.version,
            event.error
          );
          break;
        case "snapshot":
          setSnapshot(event.snapshot);
          break;
        case "playing-slot":
          setPlayingSlot(event.trackIndex, event.playingSlotIndex);
          break;
        case "transport":
          applyTransportPatch(event.patch);
          break;
        case "clip-position":
          setClipPosition({
            trackIndex: event.trackIndex,
            clipIndex: event.clipIndex,
            position: event.position,
            ts: event.ts,
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

  useSSE("/api/ableton/events", onMessage);
}
