import { create } from "zustand";
import type { VmixState } from "@/lib/vmix/types";

/**
 * Holds the raw vMix XML string (and a paused snapshot).
 * Split out from `vmix-store` because the main store gets re-set every
 * poll tick (~150 ms) and used to drag this 50-100 KB string with it,
 * even though only the debug page ever reads it.
 *
 * Now: the debug page is the only subscriber to `rawXml`, so the rest
 * of the app no longer pays the cost of storing/copying it.
 */
interface XmlStore {
  rawXml: string;
  debugPaused: boolean;
  debugSnapshotXml: string;
  debugSnapshotState: VmixState | null;

  setRawXml: (xml: string) => void;
  toggleDebugPause: (currentVmixState: VmixState | null) => void;
}

export const useXmlStore = create<XmlStore>((set) => ({
  rawXml: "",
  debugPaused: false,
  debugSnapshotXml: "",
  debugSnapshotState: null,

  setRawXml: (rawXml) => set({ rawXml }),
  toggleDebugPause: (currentVmixState) =>
    set((state) => {
      if (state.debugPaused) {
        return {
          debugPaused: false,
          debugSnapshotXml: "",
          debugSnapshotState: null,
        };
      }
      return {
        debugPaused: true,
        debugSnapshotXml: state.rawXml,
        debugSnapshotState: currentVmixState,
      };
    }),
}));
