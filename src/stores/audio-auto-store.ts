import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * vMix's XML/TCP API does NOT expose an input's "Audio Follow Program"
 * (Auto) state — only muted/solo/audiobusses. So Nexus remembers what it
 * last set, keyed by the input's stable GUID (survives renumbering), and
 * always sends explicit AudioAutoOn / AudioAutoOff so vMix ends up in the
 * state shown. If Auto is changed directly in vMix, one click here
 * re-syncs it.
 */
interface AudioAutoState {
  byKey: Record<string, boolean>;
  set: (key: string, on: boolean) => void;
}

export const useAudioAutoStore = create<AudioAutoState>()(
  persist(
    (set) => ({
      byKey: {},
      set: (key, on) => set((s) => ({ byKey: { ...s.byKey, [key]: on } })),
    }),
    {
      name: "nexus-audio-auto",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
