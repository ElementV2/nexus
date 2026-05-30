"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSSE } from "./use-sse";

/**
 * Generic SSE subscription to a registered connection's events stream.
 * The body of every `data:` frame is a `{ type, ... }` object — meta
 * events from the manager (`__status`, `__snapshot`) and the kind's
 * own events come through the same pipe.
 *
 * Pass `null` for `id` to bypass the subscription entirely — useful
 * when the caller is still resolving which connection to target
 * (e.g. waiting for `/api/connections` to return).
 */
export function useConnectionEvents(
  id: string | null,
  onMessage: (e: MessageEvent) => void
): void {
  // Stable handler reference so swapping the callback doesn't tear
  // down the EventSource. `useSSE`'s effect deps include onMessage,
  // and we don't want a re-render to drop the stream.
  const handlerRef = useRef(onMessage);
  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  // Stable forwarder so useSSE's dep list stays constant.
  const forward = useCallback((e: MessageEvent) => {
    handlerRef.current(e);
  }, []);

  // Empty url disables the subscription per useSSE's contract.
  useSSE(
    id ? `/api/connections/${encodeURIComponent(id)}/events` : "",
    forward
  );
}
