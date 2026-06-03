"use client";

import { useEffect, useState } from "react";

/**
 * Listing of all configured connections plus their live status.
 * Returned by `/api/connections`. The sidebar and connections panel
 * both subscribe through this hook so they stay in sync.
 */
export interface ConnectionRow {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
  config: unknown;
  status: "offline" | "connecting" | "connected" | "error";
  /** Live transport label from the broker (e.g. vMix "TCP (real-time)" /
   *  "HTTP (fallback)"). Null → fall back to the kind's static tagline. */
  statusLabel?: string | null;
}

export interface KindRow {
  kind: string;
  displayName: string;
  tagline?: string;
  /** Fire-and-forget transport (no reply) — "connected" is optimistic. */
  sendOnly?: boolean;
  defaultConfig: unknown;
  pages?: Array<{ href: string; label: string }>;
}

interface ConnectionsResponse {
  connections: ConnectionRow[];
  kinds: KindRow[];
  /** Default connection id per kind (`{ vmix: "<id>" }`). Drives the
   *  inspector's "Default" choice and the connections-panel star. */
  defaults?: Record<string, string>;
}

/**
 * Single SHARED connections source. `useConnections()` used to spin up
 * its own `setInterval` fetch loop, and it's mounted from ~9 places
 * (providers, sidebar, command hooks, pages) — so the same endpoint got
 * hit by that many independent timers, none of them paused while the tab
 * was hidden. This module funnels every consumer onto ONE poller that:
 *   • runs only while at least one consumer is mounted,
 *   • pauses while the tab is hidden (and refetches on re-show),
 *   • only notifies subscribers when the payload actually changed
 *     (byte-diff), so a brand-new `data` reference isn't published every
 *     5 s — which otherwise cascaded re-renders/memos downstream.
 */
const POLL_MS = 5_000;

type Listener = (data: ConnectionsResponse | null) => void;

const shared = {
  data: null as ConnectionsResponse | null,
  lastJson: "",
  listeners: new Set<Listener>(),
  interval: null as ReturnType<typeof setInterval> | null,
  inFlight: false,
};

async function load(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  if (shared.inFlight) return;
  shared.inFlight = true;
  try {
    const res = await fetch("/api/connections", { cache: "no-store" });
    if (!res.ok) return;
    const text = await res.text();
    if (text === shared.lastJson) return; // unchanged — don't churn refs
    shared.lastJson = text;
    shared.data = JSON.parse(text) as ConnectionsResponse;
    for (const l of shared.listeners) l(shared.data);
  } catch {
    /* network blip — keep last good data */
  } finally {
    shared.inFlight = false;
  }
}

function onVisibility(): void {
  if (!document.hidden) void load();
}

function ensurePolling(): void {
  if (shared.interval) return;
  void load();
  shared.interval = setInterval(() => void load(), POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
}

function stopPolling(): void {
  if (shared.interval) clearInterval(shared.interval);
  shared.interval = null;
  document.removeEventListener("visibilitychange", onVisibility);
}

export function useConnections(): {
  data: ConnectionsResponse | null;
  loading: boolean;
  refresh: () => void;
} {
  const [data, setData] = useState<ConnectionsResponse | null>(shared.data);

  useEffect(() => {
    const listener: Listener = (d) => setData(d);
    shared.listeners.add(listener);
    // Seeds from `shared.data` via useState initializer; the poller
    // (or another live consumer) publishes the next change to `listener`.
    ensurePolling();
    return () => {
      shared.listeners.delete(listener);
      if (shared.listeners.size === 0) stopPolling();
    };
  }, []);

  return {
    data,
    loading: data === null,
    refresh: () => void load(),
  };
}
