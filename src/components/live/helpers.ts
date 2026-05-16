import type { VmixInput, VmixState } from "@/lib/vmix/types";

/* ── Hoisted constant arrays — kept out of render to avoid re-allocation
 *    on every poll tick. */
export const VIDEO_CALL_VIDEO_SOURCES = [
  "None",
  "Output1",
  "Output2",
  "Output3",
  "Output4",
] as const;
export const VIDEO_CALL_AUDIO_BASE = ["Master", "Headphones"] as const;

/* ── Route targets selectable in the TAP MODE bar ─────────────────── */
export type RouteTarget =
  | { kind: "pgm" }
  | { kind: "pvw" }
  | { kind: "mix"; index: number }
  | { kind: "out"; outputFn: string; xmlNumber: number }
  | { kind: "ovl"; layer: number };

export function routeTargetId(t: RouteTarget): string {
  switch (t.kind) {
    case "pgm":
    case "pvw":
      return t.kind;
    case "mix":
      return `mix-${t.index}`;
    case "out":
      return `out-${t.xmlNumber}`;
    case "ovl":
      return `ovl-${t.layer}`;
  }
}

export function routeTargetLabel(t: RouteTarget): string {
  switch (t.kind) {
    case "pgm":
      return "PGM";
    case "pvw":
      return "PVW";
    case "mix":
      return `MIX ${t.index}`;
    case "out":
      return `OUT ${t.xmlNumber}`;
    case "ovl":
      return `OVL ${t.layer}`;
  }
}

/**
 * Whether a given route target is currently "active" for a tile —
 * i.e. that tile is right now the source / on-air / on-overlay /
 * on-output for that destination.
 */
export function isTargetActiveFor(
  target: RouteTarget,
  tile: number,
  state: VmixState
): boolean {
  switch (target.kind) {
    case "pgm":
      return tile === state.activeInput;
    case "pvw":
      return tile === state.previewInput;
    case "mix": {
      const m = state.mixes.find((x) => x.number === target.index);
      return m?.active === tile;
    }
    case "out": {
      // vMix can emit multiple <output> entries sharing the same
      // `number` (one per output type — Fullscreen / Output / etc.).
      // A `.find()` returned only the first match, so an OUT that was
      // genuinely routed via a later entry never lit up in the TAP
      // MODE bar even when the corresponding chip on the tile said
      // otherwise. `.some()` accepts any matching entry.
      return state.outputs.some(
        (x) => x.number === target.xmlNumber && x.inputNumber === tile
      );
    }
    case "ovl":
      return state.overlays.some(
        (o) => o.number === target.layer && o.inputNumber === tile
      );
  }
}

export function routeTargetAccent(t: RouteTarget): {
  fg: string;
  tint: string;
} {
  switch (t.kind) {
    case "pgm":
      return { fg: "var(--pgm)", tint: "var(--pgm-tint)" };
    case "pvw":
      return { fg: "var(--pvw)", tint: "var(--pvw-tint)" };
    case "mix":
      return { fg: "var(--cyan)", tint: "var(--cyan-tint)" };
    case "out":
      return { fg: "var(--ink)", tint: "var(--card-hi)" };
    case "ovl":
      return { fg: "var(--amber)", tint: "var(--amber-tint)" };
  }
}

export function shortType(input: VmixInput): string {
  const t = input.type;
  if (input.type === "Placeholder") return "Placeholder";
  if (t === "Capture") return "Capture";
  if (t === "Audio") return "Audio";
  if (t === "AudioFile") return "Audio file";
  if (t === "GT" || t === "Title") return "GT title";
  if (t === "Image") return "Image";
  if (t === "Video") return "Media";
  if (t === "VideoList") return "Playlist";
  if (t === "Browser") return "Browser";
  if (t === "VideoCall") return "NDI call";
  if (t === "Mix") return "Mix";
  if (t === "Colour") return "Colour";
  if (t === "Xaml") return "XAML";
  if (t === "Photos") return "Photos";
  return t || "Source";
}

export type TallyInfo = {
  activeInput: number;
  previewInput: number;
  overlays: { number: number; inputNumber: number }[];
  outputs: {
    type: string;
    number: number;
    source: string;
    inputNumber?: number;
  }[];
  mixes: { number: number; active: number; preview: number }[];
};

export type MixInfo = { label: string; apiIndex: number };

export interface TransitionButton {
  label: string;
  fn: string;
  duration?: number;
  /** Optional secondary line under the label (e.g. effect or duration). */
  hint?: string;
}
