"use client";

import { useEffect, useRef } from "react";
import { useVmixEvents } from "@/hooks/use-vmix-events";
import { useAbletonEvents } from "@/hooks/use-ableton-events";
import { useVmixStore } from "@/stores/vmix-store";

export function VmixProvider({ children }: { children: React.ReactNode }) {
  useLoadPreferences();
  useVmixEvents();
  useAbletonEvents();
  return <>{children}</>;
}

interface PrefsResponse {
  vmix_host: string;
  vmix_port: number;
  vmix_srt_port: number;
  polling_interval: number;
}

const PREFS_FETCH_TIMEOUT_MS = 3000;

/**
 * Mirror the server-side preferences into the client store.
 *
 * Previously polled every 5 s — on a 4-hour show that's ~2880 fetches
 * per tab for data that rarely changes. In-app writers (Connections
 * panel, Network scan) call `PUT /api/preferences` and mutate the
 * store directly, so the only "external" writer is the launcher
 * window — and an operator who touches the launcher is also touching
 * the browser, which fires `focus`. So we fetch once on mount and
 * refetch on window focus: same behaviour, zero idle traffic.
 */
function useLoadPreferences() {
  const setConnectionInfo = useVmixStore((s) => s.setConnectionInfo);
  const setPollingInterval = useVmixStore((s) => s.setPollingInterval);
  const last = useRef<PrefsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;

    const sync = async () => {
      inFlight?.abort();
      inFlight = new AbortController();
      const timeout = setTimeout(
        () => inFlight?.abort(),
        PREFS_FETCH_TIMEOUT_MS
      );
      try {
        const res = await fetch("/api/preferences", {
          cache: "no-store",
          signal: inFlight.signal,
        });
        if (!res.ok) return;
        const prefs = (await res.json()) as PrefsResponse;
        if (cancelled) return;
        const prev = last.current;
        if (
          !prev ||
          prev.vmix_host !== prefs.vmix_host ||
          prev.vmix_port !== prefs.vmix_port ||
          prev.vmix_srt_port !== prefs.vmix_srt_port
        ) {
          setConnectionInfo(
            prefs.vmix_host,
            prefs.vmix_port,
            prefs.vmix_srt_port
          );
        }
        if (!prev || prev.polling_interval !== prefs.polling_interval) {
          setPollingInterval(prefs.polling_interval);
        }
        // Only mutate the ref AFTER the cancel guard so an unmounted
        // component never publishes a stale read.
        last.current = prefs;
      } catch {
        // server warming up, request aborted, or network blip
      } finally {
        clearTimeout(timeout);
      }
    };

    sync();
    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      inFlight?.abort();
    };
  }, [setConnectionInfo, setPollingInterval]);
}
