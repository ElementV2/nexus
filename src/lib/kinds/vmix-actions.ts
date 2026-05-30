import type {
  ActionDefinition,
  ActionOption,
} from "@/lib/core/types";

/**
 * Full catalog of vMix actions exposed to the action / preset browser.
 *
 * Goal: every button operation that the Nexus UI can perform must
 * exist here as an ActionDefinition so a surface (Stream Deck, etc.)
 * can drive it directly. The shape of the resulting command body
 * mirrors `src/lib/vmix/commands.ts` — the kind's adapter forwards
 * the `{Function, Input?, Value?, Mix?, Duration?}` envelope to the
 * vMix HTTP API as-is.
 *
 * Helpers below cut boilerplate for the common option shapes (input
 * picker, mix picker, no-arg call, value-only call). Adding a new
 * action is usually a one-liner via these.
 */

// ─────────────────────────── Option fragments ─────────────────────────

// vMix's `Input=` parameter accepts a number, a title, or a UUID —
// the operator might bind a key to "Camera 1" by name, "5" by index,
// or a stable GUID. Keep this as a free-text field so all three
// work. The toCommand helpers still String() everything so the
// number-shaped default round-trips correctly.
const inputOpt: ActionOption = {
  id: "input",
  type: "string",
  label: "Input",
  default: "1",
  placeholder: "Number, title, or UUID",
};
const mixOpt: ActionOption = {
  id: "mix",
  type: "number",
  label: "Mix #",
  default: 1,
  min: 1,
  max: 4,
};
const durationOpt: ActionOption = {
  id: "duration",
  type: "number",
  label: "Duration (ms)",
  default: 500,
  min: 0,
  max: 10000,
  step: 50,
};
// (Earlier prototype generic `valueOpt` helper removed — every option
// is declared inline below for clarity. The compact builders `noArg`,
// `inputOnly`, `valueOnly`, `inputValue` cover the patterns that
// repeat.)

// ─────────────────────────── Action builders ──────────────────────────

const noArg = (
  id: string,
  label: string,
  category: string,
  fn: string,
  description?: string
): ActionDefinition => ({
  id,
  label,
  category,
  description,
  toCommand: () => ({ Function: fn }),
});

const inputOnly = (
  id: string,
  label: string,
  category: string,
  fn: string,
  description?: string
): ActionDefinition => ({
  id,
  label,
  category,
  description,
  options: [inputOpt],
  toCommand: (o) => ({ Function: fn, Input: String(o.input ?? 1) }),
});

const valueOnly = (
  id: string,
  label: string,
  category: string,
  fn: string,
  option: ActionOption,
  description?: string
): ActionDefinition => ({
  id,
  label,
  category,
  description,
  options: [option],
  toCommand: (o) => ({ Function: fn, Value: String(o[option.id] ?? "") }),
});

const inputValue = (
  id: string,
  label: string,
  category: string,
  fn: string,
  valueOption: ActionOption,
  description?: string
): ActionDefinition => ({
  id,
  label,
  category,
  description,
  options: [inputOpt, valueOption],
  toCommand: (o) => ({
    Function: fn,
    Input: String(o.input ?? 1),
    Value: String(o[valueOption.id] ?? ""),
  }),
});

// ─────────────────────────── Catalog ──────────────────────────────────

export const vmixActions: ActionDefinition[] = [
  // ════════════════════════ Transitions ═══════════════════════════════
  {
    id: "cut",
    label: "Cut",
    category: "Transitions",
    description: "Cut to an input on a mix bus.",
    options: [inputOpt, mixOpt],
    toCommand: (o) => ({
      Function: "Cut",
      Input: String(o.input ?? 1),
      Mix: String(((o.mix as number) ?? 1) - 1),
    }),
  },
  {
    id: "fade",
    label: "Fade",
    category: "Transitions",
    options: [inputOpt, durationOpt, mixOpt],
    toCommand: (o) => ({
      Function: "Fade",
      Input: String(o.input ?? 1),
      Duration: String(o.duration ?? 500),
      Mix: String(((o.mix as number) ?? 1) - 1),
    }),
  },
  {
    id: "merge",
    label: "Merge",
    category: "Transitions",
    options: [inputOpt, durationOpt, mixOpt],
    toCommand: (o) => ({
      Function: "Merge",
      Input: String(o.input ?? 1),
      Duration: String(o.duration ?? 500),
      Mix: String(((o.mix as number) ?? 1) - 1),
    }),
  },
  {
    id: "wipe",
    label: "Wipe",
    category: "Transitions",
    options: [inputOpt, durationOpt],
    toCommand: (o) => ({
      Function: "Wipe",
      Input: String(o.input ?? 1),
      Duration: String(o.duration ?? 500),
    }),
  },
  {
    id: "slide",
    label: "Slide",
    category: "Transitions",
    options: [inputOpt, durationOpt],
    toCommand: (o) => ({
      Function: "Slide",
      Input: String(o.input ?? 1),
      Duration: String(o.duration ?? 500),
    }),
  },
  {
    id: "fly",
    label: "Fly",
    category: "Transitions",
    options: [inputOpt, durationOpt],
    toCommand: (o) => ({
      Function: "Fly",
      Input: String(o.input ?? 1),
      Duration: String(o.duration ?? 500),
    }),
  },
  {
    id: "zoom",
    label: "Zoom",
    category: "Transitions",
    options: [inputOpt, durationOpt],
    toCommand: (o) => ({
      Function: "Zoom",
      Input: String(o.input ?? 1),
      Duration: String(o.duration ?? 500),
    }),
  },
  {
    id: "alpha-fade",
    label: "Alpha Fade",
    category: "Transitions",
    options: [inputOpt, durationOpt],
    toCommand: (o) => ({
      Function: "AlphaFade",
      Input: String(o.input ?? 1),
      Duration: String(o.duration ?? 500),
    }),
  },
  {
    id: "stinger",
    label: "Stinger",
    category: "Transitions",
    options: [
      {
        id: "channel",
        type: "dropdown",
        label: "Stinger #",
        default: "1",
        choices: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          id: String(n),
          label: `S${n}`,
        })),
      },
      inputOpt,
      mixOpt,
    ],
    toCommand: (o) => ({
      Function: `Stinger${o.channel ?? 1}`,
      Input: String(o.input ?? 1),
      Mix: String(((o.mix as number) ?? 1) - 1),
    }),
  },
  {
    id: "transition-slot",
    label: "Transition slot 1-4",
    category: "Transitions",
    description:
      "Fire one of the configured GUI transition buttons (Transition1..4).",
    options: [
      {
        id: "slot",
        type: "dropdown",
        label: "Slot",
        default: "1",
        choices: [1, 2, 3, 4].map((n) => ({
          id: String(n),
          label: `T${n}`,
        })),
      },
    ],
    toCommand: (o) => ({ Function: `Transition${o.slot ?? 1}` }),
  },
  {
    id: "preview-input",
    label: "Preview input",
    category: "Transitions",
    options: [inputOpt, mixOpt],
    toCommand: (o) => ({
      Function: "PreviewInput",
      Input: String(o.input ?? 1),
      Mix: String(((o.mix as number) ?? 1) - 1),
    }),
  },
  noArg("fade-to-black", "Fade to black", "Transitions", "FadeToBlack"),
  noArg("quick-play", "Quick play", "Transitions", "QuickPlay"),

  // ── Mix takes (no input — performs PVW→PGM on the given mix) ────
  // vMix's `Cut`/`Fade`/`Auto` Function with only a `Mix` argument
  // executes the take using whatever's currently on PVW. Distinct
  // from the input-aware variants above (which preview + take in one
  // step).
  {
    id: "mix-cut",
    label: "Mix take · Cut",
    category: "Transitions",
    description: "PVW → PGM on the given mix using a hard cut.",
    options: [mixOpt],
    toCommand: (o) => ({
      Function: "Cut",
      Mix: String(((o.mix as number) ?? 1) - 1),
    }),
  },
  {
    id: "mix-fade",
    label: "Mix take · Fade",
    category: "Transitions",
    options: [mixOpt, durationOpt],
    toCommand: (o) => ({
      Function: "Fade",
      Duration: String(o.duration ?? 500),
      Mix: String(((o.mix as number) ?? 1) - 1),
    }),
  },
  {
    id: "mix-auto",
    label: "Mix take · Auto (default transition)",
    category: "Transitions",
    description: "Triggers the mix's currently-armed transition.",
    options: [mixOpt],
    toCommand: (o) => ({
      Function: "Transition1",
      Mix: String(((o.mix as number) ?? 1) - 1),
    }),
  },

  // ════════════════════════ Overlays ══════════════════════════════════
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
    inputOnly(
      `overlay-${n}-input`,
      `OVL${n} show input`,
      "Overlays",
      `OverlayInput${n}`
    ),
    noArg(
      `overlay-${n}-off`,
      `OVL${n} hide`,
      "Overlays",
      `OverlayInput${n}Off`
    ),
    noArg(
      `overlay-${n}-in`,
      `OVL${n} in`,
      "Overlays",
      `OverlayInput${n}In`
    ),
    noArg(
      `overlay-${n}-out`,
      `OVL${n} out`,
      "Overlays",
      `OverlayInput${n}Out`
    ),
    noArg(
      `overlay-${n}-zoom`,
      `OVL${n} zoom toggle`,
      "Overlays",
      `OverlayInput${n}Zoom`
    ),
  ]),

  // ── Generic overlay actions — single preset, channel via dropdown ──
  // Used by the slim preset catalog. Per-channel actions above stay
  // for advanced flows that want a fixed OVL baked in.
  {
    id: "overlay-show-generic",
    label: "Show overlay (pick channel + input)",
    category: "Overlays",
    options: [
      {
        id: "channel",
        type: "dropdown",
        label: "Overlay #",
        default: "1",
        choices: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          id: String(n),
          label: `OVL${n}`,
        })),
      },
      inputOpt,
    ],
    toCommand: (o) => ({
      Function: `OverlayInput${o.channel ?? 1}`,
      Input: String(o.input ?? 1),
    }),
  },
  {
    id: "overlay-hide-generic",
    label: "Hide overlay (pick channel)",
    category: "Overlays",
    options: [
      {
        id: "channel",
        type: "dropdown",
        label: "Overlay #",
        default: "1",
        choices: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          id: String(n),
          label: `OVL${n}`,
        })),
      },
    ],
    toCommand: (o) => ({ Function: `OverlayInput${o.channel ?? 1}Off` }),
  },
  {
    id: "overlay-in-generic",
    label: "Overlay In (pick channel)",
    category: "Overlays",
    options: [
      {
        id: "channel",
        type: "dropdown",
        label: "Overlay #",
        default: "1",
        choices: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          id: String(n),
          label: `OVL${n}`,
        })),
      },
    ],
    toCommand: (o) => ({ Function: `OverlayInput${o.channel ?? 1}In` }),
  },
  {
    id: "overlay-out-generic",
    label: "Overlay Out (pick channel)",
    category: "Overlays",
    options: [
      {
        id: "channel",
        type: "dropdown",
        label: "Overlay #",
        default: "1",
        choices: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          id: String(n),
          label: `OVL${n}`,
        })),
      },
    ],
    toCommand: (o) => ({ Function: `OverlayInput${o.channel ?? 1}Out` }),
  },
  {
    id: "overlay-zoom-generic",
    label: "Overlay Zoom toggle (pick channel)",
    category: "Overlays",
    options: [
      {
        id: "channel",
        type: "dropdown",
        label: "Overlay #",
        default: "1",
        choices: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          id: String(n),
          label: `OVL${n}`,
        })),
      },
    ],
    toCommand: (o) => ({ Function: `OverlayInput${o.channel ?? 1}Zoom` }),
  },

  // ════════════════════════ Audio (per input) ═════════════════════════
  inputOnly("audio-on", "Audio on", "Audio", "AudioOn"),
  inputOnly("audio-off", "Audio off (mute)", "Audio", "AudioOff"),
  inputOnly("audio-toggle", "Audio toggle", "Audio", "Audio"),
  inputOnly("solo-on", "Solo on", "Audio", "SoloOn"),
  inputOnly("solo-off", "Solo off", "Audio", "SoloOff"),
  inputOnly("audio-auto-on", "Audio auto on", "Audio", "AudioAutoOn"),
  inputOnly("audio-auto-off", "Audio auto off", "Audio", "AudioAutoOff"),
  inputValue(
    "set-volume",
    "Set volume",
    "Audio",
    "SetVolume",
    {
      id: "volume",
      type: "number",
      label: "Volume (0-100)",
      default: 100,
      min: 0,
      max: 100,
    }
  ),
  inputValue(
    "set-balance",
    "Set balance",
    "Audio",
    "SetBalance",
    {
      id: "balance",
      type: "number",
      label: "Balance (-1..1)",
      default: 0,
      min: -1,
      max: 1,
      step: 0.05,
    }
  ),
  inputValue(
    "set-gain",
    "Set gain (dB)",
    "Audio",
    "SetGain",
    {
      id: "gain",
      type: "number",
      label: "Gain (dB)",
      default: 0,
      min: -24,
      max: 24,
      step: 0.5,
    }
  ),

  // ════════════════════════ Audio buses ═══════════════════════════════
  ...["M", "A", "B", "C", "D", "E", "F", "G"].flatMap((bus) => [
    {
      id: `audio-bus-${bus.toLowerCase()}-on`,
      label: `Route to bus ${bus}`,
      category: "Audio Buses",
      options: [inputOpt],
      toCommand: (o: Record<string, unknown>) => ({
        Function: "AudioBusOn",
        Input: String(o.input ?? 1),
        Value: bus,
      }),
    } as ActionDefinition,
    {
      id: `audio-bus-${bus.toLowerCase()}-off`,
      label: `Unroute from bus ${bus}`,
      category: "Audio Buses",
      options: [inputOpt],
      toCommand: (o: Record<string, unknown>) => ({
        Function: "AudioBusOff",
        Input: String(o.input ?? 1),
        Value: bus,
      }),
    } as ActionDefinition,
    {
      id: `bus-${bus.toLowerCase()}-audio-on`,
      label: `Bus ${bus} audio on`,
      category: "Audio Buses",
      toCommand: () => ({ Function: "BusXAudioOn", Value: bus }),
    } as ActionDefinition,
    {
      id: `bus-${bus.toLowerCase()}-audio-off`,
      label: `Bus ${bus} audio off`,
      category: "Audio Buses",
      toCommand: () => ({ Function: "BusXAudioOff", Value: bus }),
    } as ActionDefinition,
    {
      id: `bus-${bus.toLowerCase()}-volume`,
      label: `Bus ${bus} volume`,
      category: "Audio Buses",
      options: [
        {
          id: "volume",
          type: "number",
          label: "Volume (0-100)",
          default: 100,
          min: 0,
          max: 100,
        },
      ],
      toCommand: (o: Record<string, unknown>) => ({
        Function: `SetBus${bus}Volume`,
        Value: String(Math.round((o.volume as number) ?? 100)),
      }),
    } as ActionDefinition,
  ]),

  // ── Generic bus actions — single preset configurable to any bus ──
  // Used by the slim preset catalog. The per-letter actions above
  // stay too (they shorten advanced flows that want a fixed bus
  // baked into the action without a dropdown click).
  {
    id: "audio-bus-route",
    label: "Route input to bus",
    category: "Audio Buses",
    description: "Send an input to a specific bus (or remove it).",
    options: [
      inputOpt,
      {
        id: "bus",
        type: "dropdown",
        label: "Bus",
        default: "A",
        choices: ["M", "A", "B", "C", "D", "E", "F", "G"].map((b) => ({
          id: b,
          label: b === "M" ? "Master" : `Bus ${b}`,
        })),
      },
      { id: "enabled", type: "boolean", label: "Enabled", default: true },
    ],
    toCommand: (o) => ({
      Function: o.enabled ? "AudioBusOn" : "AudioBusOff",
      Input: String(o.input ?? 1),
      Value: String(o.bus ?? "A"),
    }),
  },
  {
    id: "bus-control",
    label: "Bus on / off",
    category: "Audio Buses",
    options: [
      {
        id: "bus",
        type: "dropdown",
        label: "Bus",
        default: "A",
        choices: ["M", "A", "B", "C", "D", "E", "F", "G"].map((b) => ({
          id: b,
          label: b === "M" ? "Master" : `Bus ${b}`,
        })),
      },
      { id: "enabled", type: "boolean", label: "Enabled", default: true },
    ],
    toCommand: (o) => ({
      Function: o.enabled ? "BusXAudioOn" : "BusXAudioOff",
      Value: String(o.bus ?? "A"),
    }),
  },
  {
    id: "bus-volume-generic",
    label: "Bus volume",
    category: "Audio Buses",
    options: [
      {
        id: "bus",
        type: "dropdown",
        label: "Bus",
        default: "A",
        choices: ["M", "A", "B", "C", "D", "E", "F", "G"].map((b) => ({
          id: b,
          label: b === "M" ? "Master" : `Bus ${b}`,
        })),
      },
      {
        id: "volume",
        type: "number",
        label: "Volume (0-100)",
        default: 100,
        min: 0,
        max: 100,
      },
    ],
    toCommand: (o) => ({
      Function: `SetBus${o.bus ?? "A"}Volume`,
      Value: String(Math.round((o.volume as number) ?? 100)),
    }),
  },

  valueOnly(
    "set-master-volume",
    "Master volume",
    "Audio Buses",
    "SetMasterVolume",
    {
      id: "volume",
      type: "number",
      label: "Volume (0-100)",
      default: 100,
      min: 0,
      max: 100,
    }
  ),
  noArg("master-audio-on", "Master audio on", "Audio Buses", "MasterAudioOn"),
  noArg(
    "master-audio-off",
    "Master audio off",
    "Audio Buses",
    "MasterAudioOff"
  ),

  // ════════════════════════ Colorimetry ═══════════════════════════════
  ...(["Lift", "Gamma", "Gain"] as const).flatMap((wheel) =>
    (["R", "G", "B", "Y"] as const).map(
      (chan): ActionDefinition => ({
        id: `cc-${wheel.toLowerCase()}-${chan.toLowerCase()}`,
        label: `CC ${wheel} ${chan}`,
        category: "Colorimetry",
        options: [
          inputOpt,
          {
            id: "value",
            type: "number",
            label: `${wheel} ${chan} (-1..1)`,
            default: 0,
            min: -1,
            max: 1,
            step: 0.01,
          },
        ],
        toCommand: (o) => ({
          Function: `SetCC${wheel}${chan}`,
          Input: String(o.input ?? 1),
          Value: ((o.value as number) ?? 0).toFixed(4),
        }),
      })
    )
  ),
  inputValue(
    "cc-hue",
    "CC Hue",
    "Colorimetry",
    "SetCCHue",
    {
      id: "hue",
      type: "number",
      label: "Hue (-180..180)",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
    }
  ),
  inputValue(
    "cc-saturation",
    "CC Saturation",
    "Colorimetry",
    "SetCCSaturation",
    {
      id: "saturation",
      type: "number",
      label: "Saturation (0..2)",
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
    }
  ),
  inputOnly(
    "cc-reset",
    "Reset colour correction",
    "Colorimetry",
    "ColourCorrectionReset"
  ),

  // ════════════════════════ Transport (per input) ═════════════════════
  inputOnly("play", "Play", "Transport", "Play"),
  inputOnly("pause", "Pause", "Transport", "Pause"),
  inputOnly("restart", "Restart", "Transport", "Restart"),
  inputOnly("play-pause", "Play / pause", "Transport", "PlayPause"),
  inputOnly("loop-toggle", "Toggle loop", "Transport", "Loop"),
  inputValue(
    "set-position",
    "Set position (ms)",
    "Transport",
    "SetPosition",
    {
      id: "position",
      type: "number",
      label: "Position (ms)",
      default: 0,
      min: 0,
      max: 3600000,
      step: 1000,
    }
  ),

  // ════════════════════════ List inputs ═══════════════════════════════
  inputOnly("next-item", "Next item", "List items", "NextItem"),
  inputOnly("previous-item", "Previous item", "List items", "PreviousItem"),
  inputValue(
    "select-index",
    "Select index",
    "List items",
    "SelectIndex",
    {
      id: "index",
      type: "number",
      label: "Index (1-based)",
      default: 1,
      min: 1,
    }
  ),
  inputValue(
    "list-remove",
    "Remove item from list",
    "List items",
    "ListRemove",
    {
      id: "index",
      type: "number",
      label: "Index (1-based)",
      default: 1,
      min: 1,
    }
  ),
  inputOnly(
    "list-remove-all",
    "Remove all items",
    "List items",
    "ListRemoveAll"
  ),
  {
    id: "list-add",
    label: "Add file to list",
    category: "List items",
    options: [
      inputOpt,
      {
        id: "path",
        type: "string",
        label: "File path",
        placeholder: "C:\\videos\\clip.mp4",
      },
    ],
    toCommand: (o) => ({
      Function: "ListAdd",
      Input: String(o.input ?? 1),
      Value: String(o.path ?? ""),
    }),
  },

  // ════════════════════════ Outputs ═══════════════════════════════════
  ...[2, 3, 4].flatMap((n) => [
    {
      id: `out-${n}-input`,
      label: `Output ${n}: send input`,
      category: "Outputs",
      options: [inputOpt],
      toCommand: (o: Record<string, unknown>) => ({
        Function: `SetOutput${n}`,
        Input: String(o.input ?? 1),
        Value: "Input",
      }),
    } as ActionDefinition,
    {
      id: `out-${n}-source`,
      label: `Output ${n}: set source`,
      category: "Outputs",
      options: [
        {
          id: "source",
          type: "dropdown",
          label: "Source",
          default: "Output",
          choices: [
            { id: "Output", label: "Program" },
            { id: "Preview", label: "Preview" },
            { id: "MultiView", label: "MultiView 1" },
            { id: "MultiView2", label: "MultiView 2" },
            { id: "MultiView3", label: "MultiView 3" },
            { id: "MultiView4", label: "MultiView 4" },
          ],
        },
      ],
      toCommand: (o: Record<string, unknown>) => ({
        Function: `SetOutput${n}`,
        Value: String(o.source ?? "Output"),
      }),
    } as ActionDefinition,
  ]),

  // ════════════════════════ Stream / Record ═══════════════════════════
  noArg("start-streaming", "Start streaming", "Stream", "StartStreaming"),
  noArg("stop-streaming", "Stop streaming", "Stream", "StopStreaming"),
  noArg(
    "start-stop-streaming",
    "Toggle streaming",
    "Stream",
    "StartStopStreaming"
  ),
  noArg("start-recording", "Start recording", "Stream", "StartRecording"),
  noArg("stop-recording", "Stop recording", "Stream", "StopRecording"),
  noArg(
    "start-stop-recording",
    "Toggle recording",
    "Stream",
    "StartStopRecording"
  ),
  noArg(
    "start-multi-corder",
    "Start MultiCorder",
    "Stream",
    "StartMultiCorder"
  ),
  noArg(
    "stop-multi-corder",
    "Stop MultiCorder",
    "Stream",
    "StopMultiCorder"
  ),

  // ════════════════════════ Timers (countdown inputs) ═════════════════
  inputOnly("start-countdown", "Start countdown", "Timers", "StartCountdown"),
  inputOnly("pause-countdown", "Pause countdown", "Timers", "PauseCountdown"),
  inputOnly("stop-countdown", "Stop countdown", "Timers", "StopCountdown"),
  inputValue(
    "set-countdown",
    "Set countdown value",
    "Timers",
    "SetCountdown",
    { id: "value", type: "string", label: "hh:mm:ss", default: "00:01:00" }
  ),
  inputValue(
    "set-countdown-duration",
    "Set countdown duration",
    "Timers",
    "SetCountdownDuration",
    { id: "value", type: "string", label: "hh:mm:ss", default: "00:01:00" }
  ),
  inputValue(
    "adjust-countdown",
    "Adjust countdown (seconds)",
    "Timers",
    "AdjustCountdown",
    {
      id: "value",
      type: "number",
      label: "Delta (s)",
      default: 10,
      min: -3600,
      max: 3600,
    }
  ),

  // ════════════════════════ Titles / GT text ══════════════════════════
  {
    id: "set-text",
    label: "Set title text",
    category: "Titles",
    options: [
      inputOpt,
      {
        id: "selectedIndex",
        type: "number",
        label: "Layer index",
        default: 0,
        min: 0,
      },
      { id: "value", type: "string", label: "Text", placeholder: "Hello" },
    ],
    toCommand: (o) => ({
      Function: "SetText",
      Input: String(o.input ?? 1),
      Value: String(o.value ?? ""),
      SelectedIndex: String(o.selectedIndex ?? 0),
    }),
  },
  {
    id: "set-text-by-name",
    label: "Set title text (by layer name)",
    category: "Titles",
    options: [
      inputOpt,
      {
        id: "selectedName",
        type: "string",
        label: "Layer name",
        placeholder: "Title1.Text",
      },
      { id: "value", type: "string", label: "Text" },
    ],
    toCommand: (o) => ({
      Function: "SetText",
      Input: String(o.input ?? 1),
      Value: String(o.value ?? ""),
      SelectedName: String(o.selectedName ?? ""),
    }),
  },
  {
    id: "set-text-colour",
    label: "Set title colour",
    category: "Titles",
    options: [
      inputOpt,
      {
        id: "selectedIndex",
        type: "number",
        label: "Layer index",
        default: 0,
        min: 0,
      },
      {
        id: "colour",
        type: "string",
        label: "Hex colour (e.g. #ff3b30)",
        default: "#ffffff",
      },
    ],
    toCommand: (o) => ({
      Function: "SetTextColour",
      Input: String(o.input ?? 1),
      Value: String(o.colour ?? "#ffffff"),
      SelectedIndex: String(o.selectedIndex ?? 0),
    }),
  },
  {
    id: "text-visible-on",
    label: "Show title layer",
    category: "Titles",
    options: [
      inputOpt,
      {
        id: "selectedIndex",
        type: "number",
        label: "Layer index",
        default: 0,
        min: 0,
      },
    ],
    toCommand: (o) => ({
      Function: "SetTextVisibleOn",
      Input: String(o.input ?? 1),
      SelectedIndex: String(o.selectedIndex ?? 0),
    }),
  },
  {
    id: "text-visible-off",
    label: "Hide title layer",
    category: "Titles",
    options: [
      inputOpt,
      {
        id: "selectedIndex",
        type: "number",
        label: "Layer index",
        default: 0,
        min: 0,
      },
    ],
    toCommand: (o) => ({
      Function: "SetTextVisibleOff",
      Input: String(o.input ?? 1),
      SelectedIndex: String(o.selectedIndex ?? 0),
    }),
  },
  inputValue(
    "select-title-preset",
    "Select title preset",
    "Titles",
    "SelectTitlePreset",
    {
      id: "preset",
      type: "number",
      label: "Preset index",
      default: 0,
      min: 0,
    }
  ),
  inputOnly(
    "next-title-preset",
    "Next title preset",
    "Titles",
    "NextTitlePreset"
  ),
  inputOnly(
    "previous-title-preset",
    "Previous title preset",
    "Titles",
    "PreviousTitlePreset"
  ),

  // ════════════════════════ Video Call ════════════════════════════════
  {
    id: "video-call-audio-source",
    label: "Video call: audio source",
    category: "Video call",
    options: [
      inputOpt,
      { id: "source", type: "string", label: "Source", placeholder: "Master" },
    ],
    toCommand: (o) => ({
      Function: "VideoCallAudioSource",
      Input: String(o.input ?? 1),
      Value: String(o.source ?? ""),
    }),
  },
  {
    id: "video-call-video-source",
    label: "Video call: video source",
    category: "Video call",
    options: [
      inputOpt,
      { id: "source", type: "string", label: "Source", placeholder: "Output1" },
    ],
    toCommand: (o) => ({
      Function: "VideoCallVideoSource",
      Input: String(o.input ?? 1),
      Value: String(o.source ?? ""),
    }),
  },

  // ════════════════════════ Replay ════════════════════════════════════
  noArg(
    "replay-start-recording",
    "Replay: start recording",
    "Replay",
    "ReplayStartRecording"
  ),
  noArg(
    "replay-stop-recording",
    "Replay: stop recording",
    "Replay",
    "ReplayStopRecording"
  ),
  noArg("replay-play", "Replay: play", "Replay", "ReplayPlay"),
  noArg("replay-pause", "Replay: pause", "Replay", "ReplayPause"),
  noArg(
    "replay-play-pause",
    "Replay: play / pause",
    "Replay",
    "ReplayPlayPause"
  ),
  noArg(
    "replay-play-forward",
    "Replay: play forward",
    "Replay",
    "ReplayPlayForward"
  ),
  noArg(
    "replay-play-backward",
    "Replay: play backward",
    "Replay",
    "ReplayPlayBackward"
  ),
  valueOnly(
    "replay-fast-forward",
    "Replay: fast forward",
    "Replay",
    "ReplayFastForward",
    {
      id: "speed",
      type: "number",
      label: "Speed",
      default: 2,
      min: 1,
      max: 64,
    }
  ),
  valueOnly(
    "replay-fast-backward",
    "Replay: fast backward",
    "Replay",
    "ReplayFastBackward",
    {
      id: "speed",
      type: "number",
      label: "Speed",
      default: 2,
      min: 1,
      max: 64,
    }
  ),
  noArg("replay-jump-to-now", "Replay: jump to now", "Replay", "ReplayJumpToNow"),
  valueOnly(
    "replay-jump-frames",
    "Replay: jump N frames",
    "Replay",
    "ReplayJumpFrames",
    {
      id: "frames",
      type: "number",
      label: "Frames (±)",
      default: 1,
      min: -3600,
      max: 3600,
    }
  ),
  noArg("replay-live", "Replay: live mode", "Replay", "ReplayLive"),
  noArg(
    "replay-live-toggle",
    "Replay: toggle live",
    "Replay",
    "ReplayLiveToggle"
  ),
  noArg("replay-recorded", "Replay: recorded mode", "Replay", "ReplayRecorded"),
  noArg("replay-show-hide", "Replay: show / hide", "Replay", "ReplayShowHide"),
  valueOnly(
    "replay-set-speed",
    "Replay: set speed",
    "Replay",
    "ReplaySetSpeed",
    {
      id: "speed",
      type: "number",
      label: "Speed",
      default: 1,
      min: 0.1,
      max: 4,
      step: 0.05,
    }
  ),
  valueOnly(
    "replay-change-speed",
    "Replay: change speed (delta)",
    "Replay",
    "ReplayChangeSpeed",
    {
      id: "delta",
      type: "number",
      label: "Delta",
      default: 1,
      min: -64,
      max: 64,
    }
  ),
  noArg(
    "replay-direction-forward",
    "Replay: set direction forward",
    "Replay",
    "ReplaySetDirectionForward"
  ),
  noArg(
    "replay-direction-backward",
    "Replay: set direction backward",
    "Replay",
    "ReplaySetDirectionBackward"
  ),
  noArg(
    "replay-change-direction",
    "Replay: change direction",
    "Replay",
    "ReplayChangeDirection"
  ),
  noArg(
    "replay-select-channel-a",
    "Replay: select channel A",
    "Replay",
    "ReplaySelectChannelA"
  ),
  noArg(
    "replay-select-channel-b",
    "Replay: select channel B",
    "Replay",
    "ReplaySelectChannelB"
  ),
  noArg(
    "replay-select-channel-ab",
    "Replay: select channel A+B",
    "Replay",
    "ReplaySelectChannelAB"
  ),
  noArg(
    "replay-swap-channels",
    "Replay: swap channels",
    "Replay",
    "ReplaySwapChannels"
  ),
  noArg("replay-mark-in", "Replay: mark in", "Replay", "ReplayMarkIn"),
  noArg("replay-mark-out", "Replay: mark out", "Replay", "ReplayMarkOut"),
  noArg("replay-mark-cancel", "Replay: mark cancel", "Replay", "ReplayMarkCancel"),
  noArg(
    "replay-mark-in-live",
    "Replay: mark in (live)",
    "Replay",
    "ReplayMarkInLive"
  ),
  valueOnly(
    "replay-mark-in-out",
    "Replay: mark in/out (seconds)",
    "Replay",
    "ReplayMarkInOut",
    {
      id: "seconds",
      type: "number",
      label: "Seconds",
      default: 5,
      min: 1,
      max: 3600,
    }
  ),
  valueOnly(
    "replay-mark-in-out-live",
    "Replay: mark in/out live",
    "Replay",
    "ReplayMarkInOutLive",
    {
      id: "seconds",
      type: "number",
      label: "Seconds",
      default: 5,
      min: 1,
      max: 3600,
    }
  ),
  valueOnly(
    "replay-mark-in-out-recorded",
    "Replay: mark in/out recorded",
    "Replay",
    "ReplayMarkInOutRecorded",
    {
      id: "seconds",
      type: "number",
      label: "Seconds",
      default: 5,
      min: 1,
      max: 3600,
    }
  ),
  noArg(
    "replay-mark-in-recorded",
    "Replay: mark in (recorded)",
    "Replay",
    "ReplayMarkInRecorded"
  ),
  noArg(
    "replay-mark-in-recorded-now",
    "Replay: mark in (recorded) now",
    "Replay",
    "ReplayMarkInRecordedNow"
  ),
  // Cameras 1..8 — covers most rigs.
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((cam) => [
    noArg(
      `replay-camera-${cam}`,
      `Replay: camera ${cam}`,
      "Replay",
      `ReplayCamera${cam}`
    ),
    noArg(
      `replay-a-camera-${cam}`,
      `Replay A: camera ${cam}`,
      "Replay",
      `ReplayACamera${cam}`
    ),
    noArg(
      `replay-b-camera-${cam}`,
      `Replay B: camera ${cam}`,
      "Replay",
      `ReplayBCamera${cam}`
    ),
    noArg(
      `replay-toggle-selected-event-cam-${cam}`,
      `Replay: toggle selected event cam ${cam}`,
      "Replay",
      `ReplayToggleSelectedEventCamera${cam}`
    ),
    noArg(
      `replay-toggle-last-event-cam-${cam}`,
      `Replay: toggle last event cam ${cam}`,
      "Replay",
      `ReplayToggleLastEventCamera${cam}`
    ),
  ]),
  noArg(
    "replay-select-first-event",
    "Replay: select first event",
    "Replay",
    "ReplaySelectFirstEvent"
  ),
  noArg(
    "replay-select-last-event",
    "Replay: select last event",
    "Replay",
    "ReplaySelectLastEvent"
  ),
  noArg(
    "replay-select-next-event",
    "Replay: select next event",
    "Replay",
    "ReplaySelectNextEvent"
  ),
  noArg(
    "replay-select-previous-event",
    "Replay: select previous event",
    "Replay",
    "ReplaySelectPreviousEvent"
  ),
  noArg(
    "replay-select-all-events",
    "Replay: select all events",
    "Replay",
    "ReplaySelectAllEvents"
  ),
  noArg(
    "replay-play-selected-event",
    "Replay: play selected event",
    "Replay",
    "ReplayPlaySelectedEvent"
  ),
  noArg(
    "replay-play-selected-event-to-output",
    "Replay: play selected → output",
    "Replay",
    "ReplayPlaySelectedEventToOutput"
  ),
  noArg(
    "replay-play-last-event",
    "Replay: play last event",
    "Replay",
    "ReplayPlayLastEvent"
  ),
  noArg(
    "replay-play-last-event-to-output",
    "Replay: play last → output",
    "Replay",
    "ReplayPlayLastEventToOutput"
  ),
  valueOnly(
    "replay-play-event",
    "Replay: play event #N",
    "Replay",
    "ReplayPlayEvent",
    {
      id: "event",
      type: "number",
      label: "Event #",
      default: 1,
      min: 1,
    }
  ),
  valueOnly(
    "replay-play-event-to-output",
    "Replay: play event #N → output",
    "Replay",
    "ReplayPlayEventToOutput",
    {
      id: "event",
      type: "number",
      label: "Event #",
      default: 1,
      min: 1,
    }
  ),
  noArg(
    "replay-play-all-events",
    "Replay: play all events",
    "Replay",
    "ReplayPlayAllEvents"
  ),
  noArg(
    "replay-play-all-events-to-output",
    "Replay: play all → output",
    "Replay",
    "ReplayPlayAllEventsToOutput"
  ),
  noArg("replay-play-next", "Replay: play next", "Replay", "ReplayPlayNext"),
  noArg(
    "replay-play-previous",
    "Replay: play previous",
    "Replay",
    "ReplayPlayPrevious"
  ),
  noArg("replay-stop-events", "Replay: stop events", "Replay", "ReplayStopEvents"),
  valueOnly(
    "replay-move-selected-in",
    "Replay: move selected in-point",
    "Replay",
    "ReplayMoveSelectedInPoint",
    {
      id: "frames",
      type: "number",
      label: "Frames (±)",
      default: 1,
      min: -3600,
      max: 3600,
    }
  ),
  valueOnly(
    "replay-move-selected-out",
    "Replay: move selected out-point",
    "Replay",
    "ReplayMoveSelectedOutPoint",
    {
      id: "frames",
      type: "number",
      label: "Frames (±)",
      default: 1,
      min: -3600,
      max: 3600,
    }
  ),
  noArg(
    "replay-update-selected-in",
    "Replay: update selected in-point",
    "Replay",
    "ReplayUpdateSelectedInPoint"
  ),
  noArg(
    "replay-update-selected-out",
    "Replay: update selected out-point",
    "Replay",
    "ReplayUpdateSelectedOutPoint"
  ),
  noArg(
    "replay-jump-selected-in",
    "Replay: jump to selected in",
    "Replay",
    "ReplayJumpToSelectedInPoint"
  ),
  noArg(
    "replay-jump-selected-out",
    "Replay: jump to selected out",
    "Replay",
    "ReplayJumpToSelectedOutPoint"
  ),
  noArg(
    "replay-event-up",
    "Replay: move selected event up",
    "Replay",
    "ReplayMoveSelectedEventUp"
  ),
  noArg(
    "replay-event-down",
    "Replay: move selected event down",
    "Replay",
    "ReplayMoveSelectedEventDown"
  ),
  noArg("replay-quad-on", "Replay: quad mode on", "Replay", "ReplayQuadModeOn"),
  noArg(
    "replay-quad-off",
    "Replay: quad mode off",
    "Replay",
    "ReplayQuadModeOff"
  ),
  noArg(
    "replay-quad-toggle",
    "Replay: toggle quad mode",
    "Replay",
    "ReplayToggleQuadMode"
  ),
  valueOnly(
    "replay-set-timecode",
    "Replay: set timecode",
    "Replay",
    "ReplaySetTimecode",
    {
      id: "timecode",
      type: "string",
      label: "hh:mm:ss:ff",
      default: "00:00:00:00",
    }
  ),

  // ════════════════════════ Replay events ═════════════════════════════
  // (Distinct from `replay-play` which controls the playhead — these
  // operate on the events list.)
  noArg(
    "replay-play-events",
    "Replay: play events list",
    "Replay events",
    "ReplayPlayEvents"
  ),
  noArg(
    "replay-pause-events",
    "Replay: pause events list",
    "Replay events",
    "ReplayPauseEvents"
  ),
  valueOnly(
    "replay-play-events-by-id",
    "Replay: play events by ID list",
    "Replay events",
    "ReplayPlayEventsByID",
    {
      id: "ids",
      type: "string",
      label: "Comma-separated event IDs",
      placeholder: "1,3,5",
    }
  ),

  // ════════════════════════ PlayList (NOT list-input) ═════════════════
  // The PlayList feature plays back a sequence of inputs as a show
  // automation. Distinct from List inputs (Photos/Video List) which
  // play media items within one input.
  noArg("playlist-start", "PlayList · Start", "PlayList", "StartPlayList"),
  noArg("playlist-stop", "PlayList · Stop", "PlayList", "StopPlayList"),
  noArg(
    "playlist-next",
    "PlayList · Next entry",
    "PlayList",
    "NextPlayListEntry"
  ),
  noArg(
    "playlist-prev",
    "PlayList · Previous entry",
    "PlayList",
    "PreviousPlayListEntry"
  ),
  valueOnly(
    "playlist-select",
    "PlayList · Select entry by name",
    "PlayList",
    "SelectPlayList",
    {
      id: "value",
      type: "string",
      label: "PlayList name",
      placeholder: "Show A",
    }
  ),

  // ════════════════════════ Overlays — additional ops ════════════════
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
    noArg(
      `overlay-${n}-last`,
      `OVL${n} last (re-show)`,
      "Overlays",
      `OverlayInput${n}Last`
    ),
    inputOnly(
      `overlay-${n}-prgm`,
      `OVL${n} input (program-only)`,
      "Overlays",
      `OverlayInput${n}Program`
    ),
    inputOnly(
      `overlay-${n}-prv`,
      `OVL${n} input (preview-only)`,
      "Overlays",
      `OverlayInput${n}Preview`
    ),
  ]),
  noArg(
    "overlay-all-off",
    "All overlays off",
    "Overlays",
    "OverlayInputAllOff"
  ),

  // ════════════════════════ Output extras ═════════════════════════════
  ...[2, 3, 4].map(
    (n): ActionDefinition => ({
      id: `out-${n}-replay`,
      label: `Output ${n} ← Replay`,
      category: "Outputs",
      toCommand: () => ({ Function: `SetOutput${n}`, Value: "Replay" }),
    })
  ),

  // ════════════════════════ Functions extras ══════════════════════════
  noArg(
    "toggle-external",
    "External output toggle",
    "Stream",
    "StartStopExternal"
  ),
  noArg("start-external", "External output start", "Stream", "StartExternal"),
  noArg("stop-external", "External output stop", "Stream", "StopExternal"),
  noArg("toggle-fullscreen", "Fullscreen toggle", "Stream", "Fullscreen"),
  noArg("toggle-fullscreen-2", "Fullscreen 2 toggle", "Stream", "Fullscreen2"),

  // ════════════════════════ T-slot configuration ══════════════════════
  // Reprogram the configured GUI transition buttons at runtime —
  // e.g. swap T1 from Cut to Wipe mid-show, or change the duration.
  ...[1, 2, 3, 4].map(
    (slot): ActionDefinition => ({
      id: `set-tslot-${slot}-effect`,
      label: `Set T-slot ${slot} effect`,
      category: "Transitions",
      options: [
        {
          id: "effect",
          type: "dropdown",
          label: "Effect",
          default: "Cut",
          choices: [
            "Cut",
            "Fade",
            "Zoom",
            "Wipe",
            "Slide",
            "Fly",
            "CrossZoom",
            "FlyRotate",
            "Cube",
            "CubeZoom",
            "VerticalWipe",
            "VerticalSlide",
            "Merge",
            "WipeReverse",
            "SlideReverse",
            "VerticalWipeReverse",
            "VerticalSlideReverse",
          ].map((id) => ({ id, label: id })),
        },
      ],
      toCommand: (o) => ({
        Function: `SetTransitionEffect${slot}`,
        Value: String(o.effect ?? "Cut"),
      }),
    })
  ),
  ...[1, 2, 3, 4].map(
    (slot): ActionDefinition => ({
      id: `set-tslot-${slot}-duration`,
      label: `Set T-slot ${slot} duration`,
      category: "Transitions",
      options: [
        {
          id: "duration",
          type: "number",
          label: "Duration (ms)",
          default: 500,
          min: 0,
          max: 10000,
          step: 50,
        },
      ],
      toCommand: (o) => ({
        Function: `SetTransitionDuration${slot}`,
        Value: String(o.duration ?? 500),
      }),
    })
  ),

  // ════════════════════════ Video input marks ═════════════════════════
  // Distinct from list-item marks: these operate on the In/Out points
  // of a single video/playlist input. Used for trimming on-the-fly.
  inputOnly("mark-in", "Mark In (video input)", "Video marks", "MarkIn"),
  inputOnly("mark-out", "Mark Out (video input)", "Video marks", "MarkOut"),
  inputOnly(
    "mark-clear-in-out",
    "Clear in/out (video input)",
    "Video marks",
    "ClearInOut"
  ),
  inputOnly("mark-clear-in", "Clear In (video input)", "Video marks", "ClearIn"),
  inputOnly("mark-clear-out", "Clear Out (video input)", "Video marks", "ClearOut"),

  // ════════════════════════ Scripts ═══════════════════════════════════
  {
    id: "script-start",
    label: "Script · Start",
    category: "Scripts",
    options: [
      { id: "value", type: "string", label: "Script name", placeholder: "ScriptName" },
    ],
    toCommand: (o) => ({ Function: "ScriptStart", Value: String(o.value ?? "") }),
  },
  {
    id: "script-stop",
    label: "Script · Stop",
    category: "Scripts",
    options: [
      { id: "value", type: "string", label: "Script name" },
    ],
    toCommand: (o) => ({ Function: "ScriptStop", Value: String(o.value ?? "") }),
  },
  noArg("script-stop-all", "Script · Stop all", "Scripts", "ScriptStopAll"),
  {
    id: "send-keys",
    label: "Send key press",
    category: "Scripts",
    description: "Sends a keyboard sequence to the focused window (vMix or other).",
    options: [
      { id: "value", type: "string", label: "Keys", placeholder: "Ctrl+S" },
    ],
    toCommand: (o) => ({ Function: "SendKeys", Value: String(o.value ?? "") }),
  },
  {
    id: "custom-command",
    label: "Custom raw command",
    category: "Scripts",
    description: "Escape hatch: any vMix Function name + args.",
    options: [
      { id: "Function", type: "string", label: "Function" },
      { id: "Input", type: "string", label: "Input", placeholder: "(optional)" },
      { id: "Value", type: "string", label: "Value", placeholder: "(optional)" },
      { id: "Mix", type: "string", label: "Mix", placeholder: "(optional)" },
      {
        id: "Duration",
        type: "string",
        label: "Duration",
        placeholder: "(optional ms)",
      },
    ],
    toCommand: (o) => {
      const cmd: Record<string, string> = { Function: String(o.Function ?? "") };
      for (const k of ["Input", "Value", "Mix", "Duration"]) {
        const v = o[k];
        if (v !== undefined && v !== null && String(v).length > 0) {
          cmd[k] = String(v);
        }
      }
      return cmd;
    },
  },

  // ════════════════════════ MultiView layers ══════════════════════════
  {
    id: "multiview-layer-toggle",
    label: "MultiView · Toggle layer",
    category: "MultiView",
    options: [
      inputOpt,
      { id: "layer", type: "number", label: "Layer (1-10)", default: 1, min: 1, max: 10 },
    ],
    toCommand: (o) => ({
      Function: "MultiViewOverlay",
      Input: String(o.input ?? 1),
      Value: String(o.layer ?? 1),
    }),
  },
  {
    id: "multiview-layer-on",
    label: "MultiView · Layer on",
    category: "MultiView",
    options: [
      inputOpt,
      { id: "layer", type: "number", label: "Layer (1-10)", default: 1, min: 1, max: 10 },
    ],
    toCommand: (o) => ({
      Function: "MultiViewOverlayOn",
      Input: String(o.input ?? 1),
      Value: String(o.layer ?? 1),
    }),
  },
  {
    id: "multiview-layer-off",
    label: "MultiView · Layer off",
    category: "MultiView",
    options: [
      inputOpt,
      { id: "layer", type: "number", label: "Layer (1-10)", default: 1, min: 1, max: 10 },
    ],
    toCommand: (o) => ({
      Function: "MultiViewOverlayOff",
      Input: String(o.input ?? 1),
      Value: String(o.layer ?? 1),
    }),
  },
  {
    id: "multiview-set-input",
    label: "MultiView · Set input on layer",
    category: "MultiView",
    description:
      "Replace the source shown on a MultiView layer (e.g. swap PIP source).",
    options: [
      inputOpt,
      { id: "layer", type: "number", label: "Layer (1-10)", default: 1, min: 1, max: 10 },
      { id: "value", type: "string", label: "Source input", placeholder: "1 or input title" },
    ],
    toCommand: (o) => ({
      Function: "SetMultiViewOverlay",
      Input: String(o.input ?? 1),
      Value: `${o.layer},${o.value ?? ""}`,
    }),
  },

  // ════════════════════════ Title animations ══════════════════════════
  inputOnly("title-no-flash", "Title · Transition in", "Titles", "SetTitleNoFlash"),
  inputOnly(
    "title-continuous",
    "Title · Continuous animation",
    "Titles",
    "ContinuousTitleAnimation"
  ),
  {
    id: "title-data-change-in",
    label: "Title · Data change in",
    category: "Titles",
    options: [inputOpt, { id: "value", type: "string", label: "Field" }],
    toCommand: (o) => ({
      Function: "DataChangeTitleIn",
      Input: String(o.input ?? 1),
      Value: String(o.value ?? ""),
    }),
  },
  {
    id: "title-data-change-out",
    label: "Title · Data change out",
    category: "Titles",
    options: [inputOpt, { id: "value", type: "string", label: "Field" }],
    toCommand: (o) => ({
      Function: "DataChangeTitleOut",
      Input: String(o.input ?? 1),
      Value: String(o.value ?? ""),
    }),
  },

  // ════════════════════════ Audio preset (save/load) ══════════════════
  noArg(
    "audio-preset-save",
    "Audio preset · Save 1",
    "Audio Presets",
    "AudioPresetSave"
  ),
  noArg(
    "audio-preset-load",
    "Audio preset · Load 1",
    "Audio Presets",
    "AudioPresetLoad"
  ),
  noArg(
    "audio-preset-fade",
    "Audio preset · Fade 1",
    "Audio Presets",
    "AudioPresetFade"
  ),
];
