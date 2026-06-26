"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSSE } from "./use-sse";
import { createClientLogger } from "@/lib/client-log";
import type { AutoSwitchConfig, AutoSwitchState } from "@/lib/auto-switch/types";

const log = createClientLogger("auto-switch");

/**
 * Client surface for the auto-réalisation engine. Loads the persisted config
 * once, then keeps `state` live over SSE (the engine pushes on change + a slow
 * heartbeat). All mutations go through the server (the engine is the single
 * source of truth) and echo the sanitized config back.
 */
export function useAutoSwitch() {
  const [config, setConfigState] = useState<AutoSwitchConfig | null>(null);
  const [state, setState] = useState<AutoSwitchState | null>(null);
  const configRef = useRef<AutoSwitchConfig | null>(null);

  // Initial config + state.
  useEffect(() => {
    let alive = true;
    fetch("/api/auto-switch")
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        configRef.current = j.config;
        setConfigState(j.config);
        setState(j.state);
      })
      .catch((e) => log.warn(`load failed: ${e instanceof Error ? e.message : e}`));
    return () => {
      alive = false;
    };
  }, []);

  // Live engine state.
  const onMessage = useCallback((e: MessageEvent) => {
    try {
      setState(JSON.parse(e.data) as AutoSwitchState);
    } catch {
      /* malformed frame — ignore */
    }
  }, []);
  useSSE("/api/auto-switch/events", onMessage);

  // Debounce the network write so dragging a stepper / typing a value doesn't
  // fire a disk write + engine re-apply per keystroke. The local state updates
  // instantly (optimistic); only the trailing PUT hits the server.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const saveConfig = useCallback((next: AutoSwitchConfig) => {
    configRef.current = next;
    setConfigState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const body = configRef.current;
      if (!body) return;
      fetch("/api/auto-switch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j?.ok) {
            // Only adopt the sanitized echo if the user hasn't edited again in
            // the meantime — otherwise we'd clobber their newer keystrokes.
            if (configRef.current === body) {
              configRef.current = j.config;
              setConfigState(j.config);
            }
          }
        })
        .catch((e) => log.warn(`save failed: ${e instanceof Error ? e.message : e}`));
    }, 300);
  }, []);

  const post = useCallback(async (body: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/auto-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j?.ok) {
        configRef.current = j.config;
        setConfigState(j.config);
        setState(j.state);
      }
    } catch (e) {
      log.warn(`action failed: ${e instanceof Error ? e.message : e}`);
    }
  }, []);

  const toggle = useCallback(() => post({ action: "toggle" }), [post]);
  const setEnabled = useCallback(
    (enabled: boolean) => post({ action: enabled ? "enable" : "disable" }),
    [post]
  );

  return { config, state, saveConfig, toggle, setEnabled };
}
