"use client";

import { useCallback } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { useXmlStore } from "@/stores/xml-store";
import { useSSE } from "./use-sse";
import type { VmixState } from "@/lib/vmix/types";

type Message =
  | { ok: true; state: VmixState; raw: string; ts: number }
  | { ok: false; error: string; ts: number };

/**
 * Subscribe to the server-side state broker via SSE. One open connection
 * per client; the server holds a single shared poller against vMix.
 *
 * Boilerplate (visibility, retry, cleanup) lives in `useSSE`.
 */
export function useVmixEvents() {
  const setVmixState = useVmixStore((s) => s.setVmixState);
  const setRawXml = useXmlStore((s) => s.setRawXml);
  const setConnected = useVmixStore((s) => s.setConnected);
  const setError = useVmixStore((s) => s.setError);

  const onMessage = useCallback(
    (e: MessageEvent) => {
      let msg: Message;
      try {
        msg = JSON.parse(e.data) as Message;
      } catch {
        return;
      }
      if (msg.ok) {
        setVmixState(msg.state);
        setRawXml(msg.raw);
        setConnected(true);
      } else {
        setError(msg.error);
      }
    },
    [setVmixState, setRawXml, setConnected, setError]
  );

  useSSE("/api/vmix/events", onMessage);
}
