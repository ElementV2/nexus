"use client";

import { useEffect } from "react";
import { useVmixEvents } from "@/hooks/use-vmix-events";
import { useAbletonEvents } from "@/hooks/use-ableton-events";
import { useObsEvents } from "@/hooks/use-obs-events";
import { useConnections } from "@/hooks/use-connections";
import { useVmixStore } from "@/stores/vmix-store";

export function VmixProvider({ children }: { children: React.ReactNode }) {
  useSyncVmixDefault();
  useVmixEvents();
  useAbletonEvents();
  useObsEvents();
  return <>{children}</>;
}

interface VmixCfg {
  host?: string;
  port?: number;
  srtPort?: number;
  pollingInterval?: number;
}

/**
 * Mirror the DEFAULT vMix connection's config into the client vMix store
 * (host / port / SRT port / poll interval). The legacy single-instance pages
 * (live / playlist / title / colour) read the store, so this is what makes
 * "the default vMix" the connection they drive.
 *
 * Sources from `/api/connections` (the registry — the single source of truth)
 * via the shared `useConnections` poller, NOT the old flat `vmix_host` mirror
 * fields. Re-runs only when the connections payload actually changes (the
 * hook byte-diffs before publishing), so there's no idle churn.
 */
function useSyncVmixDefault() {
  const { data } = useConnections();
  const setConnectionInfo = useVmixStore((s) => s.setConnectionInfo);
  const setPollingInterval = useVmixStore((s) => s.setPollingInterval);

  useEffect(() => {
    const conns = data?.connections ?? [];
    if (conns.length === 0) return;
    const defId = data?.defaults?.vmix;
    const conn =
      conns.find((c) => c.id === defId && c.kind === "vmix") ??
      conns.find((c) => c.kind === "vmix" && c.enabled) ??
      conns.find((c) => c.kind === "vmix");
    if (!conn) return;
    const cfg = (conn.config ?? {}) as VmixCfg;
    if (typeof cfg.host !== "string" || !cfg.host) return;
    setConnectionInfo(
      cfg.host,
      typeof cfg.port === "number" ? cfg.port : 8088,
      typeof cfg.srtPort === "number" ? cfg.srtPort : 5000
    );
    if (typeof cfg.pollingInterval === "number") {
      setPollingInterval(cfg.pollingInterval);
    }
  }, [data, setConnectionInfo, setPollingInterval]);
}
