"use client";

import { useEffect } from "react";

/** How long we wait before tearing down the SSE connection when the
 *  tab goes hidden. Short flips (200 ms tab-switch to copy something)
 *  shouldn't drop the broker subscription — the server then tears down
 *  the underlying poll/socket and the next visible moment has to
 *  rebuild from scratch. A few seconds is plenty. */
const HIDE_GRACE_MS = 5_000;

/**
 * Shared SSE-subscription scaffolding.
 *
 * Replaces the near-identical EventSource + visibility + retry boilerplate
 * that used to live in `use-vmix-events` and `use-ableton-events`. Each
 * hook now only declares its URL and a per-message handler — everything
 * else (open on mount, close on unmount, debounced close on tab-hide,
 * re-open on tab-visible, retry after abrupt close) lives here.
 */
export function useSSE(
  url: string,
  onMessage: (e: MessageEvent) => void
): void {
  useEffect(() => {
    // Falsy url = disabled. Callers in bootstrap states (e.g. waiting
    // for a connection id to resolve) pass "" to suspend the
    // subscription without unmounting the hook. We still install the
    // effect so React keeps the hook order stable across renders, but
    // skip all the EventSource work.
    if (!url) return;

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const close = () => {
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      es?.close();
      es = null;
    };

    const open = () => {
      // Cancel any pending close — coming back into view should keep
      // the connection alive if it survived the grace window.
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      // Don't open while the tab is hidden — saves CPU + bandwidth.
      if (typeof document !== "undefined" && document.hidden) return;
      if (es) return;

      es = new EventSource(url);
      es.onopen = () => {
        attempt = 0; // healthy again → reset backoff
      };
      es.onmessage = onMessage;
      es.onerror = () => {
        // The browser usually recovers on its own; if it doesn't, we
        // close and retry with capped exponential backoff + jitter. The
        // jitter is what matters at broadcast scale: without it, every
        // open tab + the variables stream reconnect in lockstep waves
        // after a server blip and hammer the just-restarted server.
        if (es?.readyState === EventSource.CLOSED) {
          if (retry) clearTimeout(retry);
          const delay = Math.min(15_000, 1_000 * 2 ** attempt) + Math.random() * 1_000;
          attempt++;
          retry = setTimeout(() => {
            retry = null;
            open();
          }, delay);
        }
      };
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        // Don't tear down immediately — schedule the close. A quick
        // alt-tab to grab something else from a window will cancel it
        // on the way back.
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          hideTimer = null;
          close();
        }, HIDE_GRACE_MS);
      } else {
        open();
      }
    };

    open();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (hideTimer) clearTimeout(hideTimer);
      close();
    };
  }, [url, onMessage]);
}
