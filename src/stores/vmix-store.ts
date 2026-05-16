import { create } from "zustand";
import type { VmixState } from "@/lib/vmix/types";
import { POLLING_INTERVAL_MS, VMIX_DEFAULT_PORT } from "@/lib/vmix/constants";

interface VmixStore {
  // Server-side connection target (mirrored from preferences for display)
  vmixHost: string;
  vmixPort: number;
  vmixSrtPort: number;

  // Live status — derived from polling success
  connected: boolean;
  error: string | null;
  pollingInterval: number;

  // Parsed live state
  vmixState: VmixState | null;

  // Actions
  setConnectionInfo: (host: string, port: number, srtPort: number) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setVmixState: (state: VmixState) => void;
  setPollingInterval: (ms: number) => void;
}

export const useVmixStore = create<VmixStore>((set) => ({
  vmixHost: "localhost",
  vmixPort: VMIX_DEFAULT_PORT,
  vmixSrtPort: 5000,
  connected: false,
  error: null,
  pollingInterval: POLLING_INTERVAL_MS,
  vmixState: null,

  setConnectionInfo: (vmixHost, vmixPort, vmixSrtPort) =>
    set({ vmixHost, vmixPort, vmixSrtPort }),
  setConnected: (connected) =>
    set({ connected, error: connected ? null : undefined }),
  setError: (error) => set({ error, connected: false }),
  setVmixState: (vmixState) => set({ vmixState }),
  setPollingInterval: (pollingInterval) => set({ pollingInterval }),
}));
