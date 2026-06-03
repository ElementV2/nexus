"use client";

import { useEffect, useState } from "react";
import { WifiOff, Loader2 } from "lucide-react";
import { createClientLogger } from "@/lib/client-log";

const log = createClientLogger("server");

const PROBE_MS = 1500; // healthy heartbeat cadence
const RETRY_MS = 400; // after a miss, re-probe fast to confirm an outage
const PROBE_TIMEOUT_MS = 2000; // per-probe abort (hung, not-killed server)
const FAIL_THRESHOLD = 2; // consecutive misses before we declare it down

/**
 * Global "server is down" curtain. A lightweight heartbeat polls
 * `/api/health`; after a couple of consecutive misses (crash, restart, the
 * launcher killing the server, network drop) it drops a full-screen overlay
 * over the whole app — on the desktop launcher AND any browser tab — so the
 * operator immediately sees the control surface is offline instead of
 * silently clicking dead buttons. Clears itself the moment the server
 * answers again (the SSE hooks reconnect on their own underneath).
 */
export function ServerStatusOverlay() {
  const [down, setDown] = useState(false);

  useEffect(() => {
    let stopped = false;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const probe = async () => {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetch("/api/health", {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fails = 0;
        setDown((was) => {
          if (was) log.info("server reachable again");
          return false;
        });
      } catch {
        fails++;
        if (fails >= FAIL_THRESHOLD) {
          setDown((was) => {
            if (!was) log.warn("server unreachable — connection lost");
            return true;
          });
        }
      } finally {
        clearTimeout(to);
        // After a miss, re-probe quickly to confirm — so the curtain drops
        // within ~1s of a real outage instead of waiting a full slow cadence
        // between each of the two confirming misses. Healthy → slow cadence.
        if (!stopped) timer = setTimeout(probe, fails > 0 ? RETRY_MS : PROBE_MS);
      }
    };
    void probe();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!down) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(2px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        textAlign: "center",
        padding: 24,
      }}
    >
      <WifiOff size={40} style={{ color: "var(--amber)" }} />
      <div
        className="font-mono uppercase"
        style={{
          fontSize: 13,
          letterSpacing: "1.6px",
          fontWeight: 700,
          color: "var(--ink)",
        }}
      >
        Server disconnected
      </div>
      <div
        className="flex items-center gap-2"
        style={{ fontSize: 12, color: "var(--mid)" }}
      >
        <Loader2 size={13} className="animate-spin" /> Reconnecting…
      </div>
    </div>
  );
}
