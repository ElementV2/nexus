"use client";

import { useCallback } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { sendCommand } from "@/lib/vmix/api";
import type { VmixCommand } from "@/lib/vmix/commands";

export function useVmixCommand() {
  const connected = useVmixStore((s) => s.connected);

  const send = useCallback(
    async (command: VmixCommand) => {
      if (!connected) return;
      try {
        await sendCommand(command);
      } catch (err) {
        console.error("vMix command error:", err);
      }
    },
    [connected]
  );

  return send;
}
