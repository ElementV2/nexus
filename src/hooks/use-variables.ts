"use client";

import { useCallback, useState } from "react";
import { useSSE } from "./use-sse";

/**
 * Subscribe to the server-side variable bus via SSE. Returns a
 * `(connectionId, varId) → value` lookup that re-renders on every
 * change. Consumers typically only need a handful of variables, so
 * the indirection keeps subscription overhead minimal — there's one
 * EventSource per tab regardless of how many components consume it.
 *
 * Used by the Stream Deck mockup to compute feedback overrides
 * client-side so the operator sees tally/stream/record state on the
 * mocked deck the same way the physical device does.
 */

export interface VariablesByConnection {
  [connectionId: string]: Record<string, unknown>;
}

interface VariableEntry {
  connectionId: string;
  varId: string;
  value: unknown;
  ts: number;
}

export function useVariables(): VariablesByConnection {
  const [vars, setVars] = useState<VariablesByConnection>({});

  // Route through the shared useSSE scaffolding so this stream gets the
  // same visibility-teardown + jitter/backoff reconnect as every other SSE
  // consumer — it used to hand-roll its own EventSource with a fixed
  // 1500 ms retry and no tab-hidden teardown, the one stream that stayed
  // open on a hidden tab and reconnected in lockstep after a server blip.
  const onMessage = useCallback((e: MessageEvent) => {
    let msg: { type?: string; entries?: VariableEntry[] } & VariableEntry;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === "__hydrate" && Array.isArray(msg.entries)) {
      const entries = msg.entries;
      setVars(() => {
        const next: VariablesByConnection = {};
        for (const entry of entries) {
          if (!next[entry.connectionId]) next[entry.connectionId] = {};
          next[entry.connectionId][entry.varId] = entry.value;
        }
        return next;
      });
      return;
    }
    if (msg.type === "change" && msg.connectionId && msg.varId) {
      setVars((cur) => ({
        ...cur,
        [msg.connectionId]: {
          ...(cur[msg.connectionId] ?? {}),
          [msg.varId]: msg.value,
        },
      }));
    }
  }, []);

  useSSE("/api/variables/events", onMessage);
  return vars;
}
