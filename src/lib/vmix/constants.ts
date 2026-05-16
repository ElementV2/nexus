export const VMIX_DEFAULT_PORT = 8088;
export const POLLING_INTERVAL_MS = 150;
// Drag-handler throttle. Kept below the poll rate so a fader moved during
// drag commits at least once between polls (avoids race where the latest
// drag value is overwritten by an in-flight stale poll).
export const THROTTLE_RATE_MS = 80;

// Network timeouts (AbortController-driven)
export const STATE_FETCH_TIMEOUT_MS = 3000;   // pulling vmix XML state
export const COMMAND_FETCH_TIMEOUT_MS = 5000; // sending a vmix Function call
export const OVERLAY_RELOAD_DELAY_MS = 2000;  // grace period before overlay re-render

// VU Meter thresholds
export const VU_YELLOW_THRESHOLD = 0.7;
export const VU_RED_THRESHOLD = 0.9;

// Web Assets / Overlay Editor
export const ASSET_WIDTH = 1920;
export const ASSET_HEIGHT = 1080;
export const PREVIEW_SCALE = 0.5;
export const MIN_HOLE_SIZE = 20;
export const MIN_ELEMENT_SIZE = 10;
export const SNAP_THRESHOLD = 8;
export const MAX_UNDO_HISTORY = 50;

// Color Wheel
export const WHEEL_SIZE = 240;
export const DEFAULT_SENSITIVITY = 0.15;

// Audio buses
export const AUDIO_BUSES = ["M", "A", "B", "C", "D", "E", "F", "G"] as const;
/** Aux buses only — i.e. AUDIO_BUSES minus the Master "M". Used by the
 *  audio strips' per-input bus router and the XML parser's bus list. */
export const AUDIO_BUS_SENDS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number];

// Output options — xmlType/xmlNumber used to match against vMix XML <outputs>
export const OUTPUT_OPTIONS = [
  { label: "Out 2", value: "SetOutput2", xmlType: "output", xmlNumber: 2 },
  { label: "Out 3", value: "SetOutput3", xmlType: "output", xmlNumber: 3 },
  { label: "Out 4", value: "SetOutput4", xmlType: "output", xmlNumber: 4 },
] as const;

// vMix 27+ exposes 8 overlay channels and 8 stinger transitions.
// Anything iterating OvN / StingerN must use these arrays so a future
// bump (vMix 28? 30?) is a one-line change in this file rather than a
// scavenger hunt across the codebase.
export const OVERLAY_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const STINGER_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
