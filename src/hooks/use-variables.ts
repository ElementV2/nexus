"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      es = new EventSource("/api/variables/events");
      es.onmessage = (e) => {
        let msg: { type?: string; entries?: VariableEntry[] } & VariableEntry;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === "__hydrate" && Array.isArray(msg.entries)) {
          // Full snapshot — rebuild the lookup in one go.
          setVars(() => {
            const next: VariablesByConnection = {};
            for (const entry of msg.entries!) {
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
      };
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) {
          retry = setTimeout(open, 1500);
        }
      };
    };

    open();
    return () => {
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);

  return vars;
}
