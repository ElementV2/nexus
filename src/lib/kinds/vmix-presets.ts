import type { PresetDefinition } from "@/lib/core/types";

/**
 * vMix preset catalog — **one preset per logical concept**.
 *
 * The previous iteration generated per-input variants (8 inputs × 8 mixes
 * cuts = 64 tiles, etc.) which crushed the browser with redundancy.
 * Generating one tile per input is the historical approach but needs a
 * heavy filter UI to stay usable; for Nexus the inspector handles
 * per-key option editing so the catalog only needs ONE tile per
 * action concept.
 *
 * Workflow:
 *   1. Drag a preset tile (e.g. "Cut") onto a deck key.
 *   2. Click the key → inspector opens on the right.
 *   3. Set input/mix/value/etc. in the inspector form.
 *   4. Edits auto-save and re-render the hardware key.
 *
 * Pre-baked variants are kept only where the variation is HARDWARE-
 * level (each Stinger channel is a different console-side asset; T-slots
 * 1-4 are 4 separate console buttons; OVL channels 1-8 are 8 distinct
 * compositing layers — though the OVL ones now use a single preset
 * with a channel dropdown to keep the count down).
 */

export const vmixPresets: PresetDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════
  // TRANSITIONS — one tile per style, all configurable
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "pgm",
    label: "PGM (cut to input on mix)",
    category: "Transitions",
    text: "PGM",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "cut", options: { input: 1, mix: 1 } }],
  },
  {
    id: "prv",
    label: "PRV (preview input on mix)",
    category: "Transitions",
    text: "PRV",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "preview-input", options: { input: 1, mix: 1 } }],
  },
  {
    id: "trans-cut",
    label: "Cut transition",
    category: "Transitions",
    text: "CUT",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "cut", options: { input: 1, mix: 1 } }],
  },
  {
    id: "trans-fade",
    label: "Fade transition",
    category: "Transitions",
    text: "FADE",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [
      { actionId: "fade", options: { input: 1, mix: 1, duration: 500 } },
    ],
  },
  {
    id: "trans-wipe",
    label: "Wipe transition",
    category: "Transitions",
    text: "WIPE",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "wipe", options: { input: 1, duration: 500 } }],
  },
  {
    id: "trans-slide",
    label: "Slide transition",
    category: "Transitions",
    text: "SLIDE",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "slide", options: { input: 1, duration: 500 } }],
  },
  {
    id: "trans-fly",
    label: "Fly transition",
    category: "Transitions",
    text: "FLY",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "fly", options: { input: 1, duration: 500 } }],
  },
  {
    id: "trans-zoom",
    label: "Zoom transition",
    category: "Transitions",
    text: "ZOOM",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "zoom", options: { input: 1, duration: 500 } }],
  },
  {
    id: "trans-merge",
    label: "Merge transition",
    category: "Transitions",
    text: "MERGE",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [
      { actionId: "merge", options: { input: 1, mix: 1, duration: 500 } },
    ],
  },
  {
    id: "trans-alpha",
    label: "Alpha fade transition",
    category: "Transitions",
    text: "α FADE",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "alpha-fade", options: { input: 1, duration: 500 } },
    ],
  },
  {
    id: "trans-stinger",
    label: "Stinger transition",
    category: "Transitions",
    text: "STING",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "stinger",
        options: { channel: "1", input: 1, mix: 1 },
      },
    ],
  },
  {
    id: "trans-tslot",
    label: "Transition slot 1-4",
    category: "Transitions",
    text: "T-SLOT",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "transition-slot", options: { slot: "1" } }],
  },

  // ── Mix takes (no input — fires PVW→PGM on the picked mix) ──────────
  {
    id: "mix-cut",
    label: "Mix · Cut take",
    category: "Mix takes",
    text: "MIX\nCUT",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "mix-cut", options: { mix: 1 } }],
  },
  {
    id: "mix-fade",
    label: "Mix · Fade take",
    category: "Mix takes",
    text: "MIX\nFADE",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "mix-fade", options: { mix: 1, duration: 500 } }],
  },
  {
    id: "mix-auto",
    label: "Mix · Auto take",
    category: "Mix takes",
    text: "MIX\nAUTO",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "mix-auto", options: { mix: 1 } }],
  },
  {
    id: "ftb",
    label: "Fade to black",
    category: "Mix takes",
    text: "FTB",
    bgcolor: "#000000",
    fgcolor: "#ffffff",
    steps: [{ actionId: "fade-to-black" }],
  },
  {
    id: "quick-play",
    label: "Quick play",
    category: "Mix takes",
    text: "QPLAY",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "quick-play" }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // OVERLAYS — one tile per op, channel via dropdown in inspector
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "ovl-show",
    label: "Overlay · Show input",
    category: "Overlays",
    text: "OVL\nSHOW",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [
      {
        actionId: "overlay-show-generic",
        options: { channel: "1", input: 1 },
      },
    ],
  },
  {
    id: "ovl-hide",
    label: "Overlay · Hide",
    category: "Overlays",
    text: "OVL\nHIDE",
    bgcolor: "#1c1c1e",
    fgcolor: "#5ac8fa",
    steps: [
      { actionId: "overlay-hide-generic", options: { channel: "1" } },
    ],
  },
  {
    id: "ovl-in",
    label: "Overlay · In",
    category: "Overlays",
    text: "OVL\nIN",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [
      { actionId: "overlay-in-generic", options: { channel: "1" } },
    ],
  },
  {
    id: "ovl-out",
    label: "Overlay · Out",
    category: "Overlays",
    text: "OVL\nOUT",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [
      { actionId: "overlay-out-generic", options: { channel: "1" } },
    ],
  },
  {
    id: "ovl-zoom",
    label: "Overlay · Zoom toggle",
    category: "Overlays",
    text: "OVL\nZOOM",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [
      { actionId: "overlay-zoom-generic", options: { channel: "1" } },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // AUDIO — one preset per concept, input + bus picked in inspector
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "audio-toggle",
    label: "Audio · Toggle (per input)",
    category: "Audio",
    text: "AUD\nTOG",
    bgcolor: "#1c1c1e",
    fgcolor: "#34c759",
    steps: [{ actionId: "audio-toggle", options: { input: 1 } }],
  },
  {
    id: "audio-on",
    label: "Audio · On (per input)",
    category: "Audio",
    text: "AUD\nON",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "audio-on", options: { input: 1 } }],
  },
  {
    id: "audio-off",
    label: "Audio · Off / mute (per input)",
    category: "Audio",
    text: "MUTE",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "audio-off", options: { input: 1 } }],
  },
  {
    id: "audio-auto",
    label: "Audio · Auto on (per input)",
    category: "Audio",
    text: "AUTO\nAUD",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "audio-auto-on", options: { input: 1 } }],
  },
  {
    id: "audio-solo",
    label: "Audio · Solo (per input)",
    category: "Audio",
    text: "SOLO",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "solo-on", options: { input: 1 } }],
  },
  {
    id: "audio-volume",
    label: "Audio · Set input volume",
    category: "Audio",
    text: "VOL",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "set-volume", options: { input: 1, volume: 100 } },
    ],
  },
  {
    id: "audio-gain",
    label: "Audio · Set input gain (dB)",
    category: "Audio",
    text: "GAIN",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "set-gain", options: { input: 1, gain: 0 } }],
  },
  {
    id: "audio-balance",
    label: "Audio · Set input balance",
    category: "Audio",
    text: "BAL",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "set-balance", options: { input: 1, balance: 0 } },
    ],
  },

  // ── Audio buses — generic over bus letter ───────────────────────────
  {
    id: "bus-route",
    label: "Audio Bus · Route input to bus",
    category: "Audio buses",
    text: "ROUTE\nBUS",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "audio-bus-route",
        options: { input: 1, bus: "A", enabled: true },
      },
    ],
  },
  {
    id: "bus-toggle",
    label: "Audio Bus · On / off",
    category: "Audio buses",
    text: "BUS\nON",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [
      { actionId: "bus-control", options: { bus: "A", enabled: true } },
    ],
  },
  {
    id: "bus-volume",
    label: "Audio Bus · Set volume",
    category: "Audio buses",
    text: "BUS\nVOL",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "bus-volume-generic", options: { bus: "A", volume: 100 } },
    ],
  },

  // ── Master ─────────────────────────────────────────────────────────
  {
    id: "master-on",
    label: "Master · On",
    category: "Audio master",
    text: "MAST\nON",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "master-audio-on" }],
  },
  {
    id: "master-off",
    label: "Master · Mute",
    category: "Audio master",
    text: "MAST\nMUTE",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "master-audio-off" }],
  },
  {
    id: "master-volume",
    label: "Master · Set volume",
    category: "Audio master",
    text: "MAST\nVOL",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "set-master-volume", options: { volume: 100 } }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // VIDEO PLAYBACK — one preset per concept (input picked in inspector)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "play",
    label: "Play (per input)",
    category: "Video playback",
    text: "▶",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "play", options: { input: 1 } }],
  },
  {
    id: "pause",
    label: "Pause (per input)",
    category: "Video playback",
    text: "⏸",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "pause", options: { input: 1 } }],
  },
  {
    id: "play-pause",
    label: "Play / Pause toggle",
    category: "Video playback",
    text: "▶⏸",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "play-pause", options: { input: 1 } }],
  },
  {
    id: "restart",
    label: "Restart (per input)",
    category: "Video playback",
    text: "⟲",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "restart", options: { input: 1 } }],
  },
  {
    id: "loop-toggle",
    label: "Loop toggle (per input)",
    category: "Video playback",
    text: "LOOP",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "loop-toggle", options: { input: 1 } }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // LISTS — list nav for list inputs
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "list-next",
    label: "List · Next item",
    category: "Lists",
    text: "NEXT",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "next-item", options: { input: 1 } }],
  },
  {
    id: "list-prev",
    label: "List · Previous item",
    category: "Lists",
    text: "PREV",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "previous-item", options: { input: 1 } }],
  },
  {
    id: "list-select",
    label: "List · Select index",
    category: "Lists",
    text: "SEL\nIDX",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "select-index", options: { input: 1, index: 1 } },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // OUTPUTS — output 2/3/4 routing
  // ═══════════════════════════════════════════════════════════════════
  ...[2, 3, 4].flatMap((n) => [
    {
      id: `out-${n}-input`,
      label: `Output ${n} · Send input`,
      category: "Outputs",
      text: `OUT${n}\nINP`,
      bgcolor: "#5856d6",
      fgcolor: "#ffffff",
      steps: [{ actionId: `out-${n}-input`, options: { input: 1 } }],
    } as PresetDefinition,
    {
      id: `out-${n}-source`,
      label: `Output ${n} · Set source`,
      category: "Outputs",
      text: `OUT${n}\nSRC`,
      bgcolor: "#5ac8fa",
      fgcolor: "#000000",
      steps: [
        { actionId: `out-${n}-source`, options: { source: "Output" } },
      ],
    } as PresetDefinition,
  ]),

  // ═══════════════════════════════════════════════════════════════════
  // TITLES — one per concept
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "title-set-text",
    label: "Title · Set text",
    category: "Titles",
    text: "TXT",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "set-text",
        options: { input: 1, selectedIndex: 0, value: "Hello" },
      },
    ],
  },
  {
    id: "title-preset",
    label: "Title · Select preset",
    category: "Titles",
    text: "T-PSET",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "select-title-preset",
        options: { input: 1, preset: 0 },
      },
    ],
  },
  {
    id: "title-next",
    label: "Title · Next preset",
    category: "Titles",
    text: "T\n→",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "next-title-preset", options: { input: 1 } }],
  },
  {
    id: "title-prev",
    label: "Title · Previous preset",
    category: "Titles",
    text: "T\n←",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [
      { actionId: "previous-title-preset", options: { input: 1 } },
    ],
  },
  {
    id: "title-show",
    label: "Title · Layer show",
    category: "Titles",
    text: "T\nSHOW",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [
      {
        actionId: "text-visible-on",
        options: { input: 1, selectedIndex: 0 },
      },
    ],
  },
  {
    id: "title-hide",
    label: "Title · Layer hide",
    category: "Titles",
    text: "T\nHIDE",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [
      {
        actionId: "text-visible-off",
        options: { input: 1, selectedIndex: 0 },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // COUNTDOWN
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "countdown-start",
    label: "Countdown · Start",
    category: "Countdown",
    text: "CDN\n▶",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "start-countdown", options: { input: 1 } }],
  },
  {
    id: "countdown-pause",
    label: "Countdown · Pause",
    category: "Countdown",
    text: "CDN\n⏸",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "pause-countdown", options: { input: 1 } }],
  },
  {
    id: "countdown-stop",
    label: "Countdown · Stop",
    category: "Countdown",
    text: "CDN\n■",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "stop-countdown", options: { input: 1 } }],
  },
  {
    id: "countdown-set",
    label: "Countdown · Set value",
    category: "Countdown",
    text: "CDN\nSET",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "set-countdown",
        options: { input: 1, value: "00:01:00" },
      },
    ],
  },
  {
    id: "countdown-adjust",
    label: "Countdown · Adjust (±s)",
    category: "Countdown",
    text: "CDN\n±s",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "adjust-countdown",
        options: { input: 1, value: 10 },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // REPLAY — no-arg essentials + cam pickers
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "replay-rec-start",
    label: "Replay · Start recording",
    category: "Replay",
    text: "REPLAY\nREC",
    bgcolor: "#8e44ad",
    fgcolor: "#ffffff",
    steps: [{ actionId: "replay-start-recording" }],
  },
  {
    id: "replay-rec-stop",
    label: "Replay · Stop recording",
    category: "Replay",
    text: "REPLAY\nSTOP",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "replay-stop-recording" }],
  },
  {
    id: "replay-play",
    label: "Replay · Play",
    category: "Replay",
    text: "▶",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-play" }],
  },
  {
    id: "replay-pause",
    label: "Replay · Pause",
    category: "Replay",
    text: "⏸",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-pause" }],
  },
  {
    id: "replay-live",
    label: "Replay · Live mode",
    category: "Replay",
    text: "LIVE",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "replay-live" }],
  },
  {
    id: "replay-recorded",
    label: "Replay · Recorded mode",
    category: "Replay",
    text: "RECD",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "replay-recorded" }],
  },
  {
    id: "replay-mark-in",
    label: "Replay · Mark in",
    category: "Replay",
    text: "MARK\nIN",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-mark-in" }],
  },
  {
    id: "replay-mark-out",
    label: "Replay · Mark out",
    category: "Replay",
    text: "MARK\nOUT",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-mark-out" }],
  },
  {
    id: "replay-mark-last",
    label: "Replay · Mark last N seconds",
    category: "Replay",
    text: "MARK\n±s",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [
      {
        actionId: "replay-mark-in-out-live",
        options: { seconds: 10 },
      },
    ],
  },
  {
    id: "replay-play-selected",
    label: "Replay · Play selected → output",
    category: "Replay",
    text: "▶SEL",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-play-selected-event-to-output" }],
  },
  {
    id: "replay-play-last",
    label: "Replay · Play last → output",
    category: "Replay",
    text: "▶LAST",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-play-last-event-to-output" }],
  },
  {
    id: "replay-channel-a",
    label: "Replay · Channel A",
    category: "Replay",
    text: "CH A",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-select-channel-a" }],
  },
  {
    id: "replay-channel-b",
    label: "Replay · Channel B",
    category: "Replay",
    text: "CH B",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "replay-select-channel-b" }],
  },
  {
    id: "replay-channel-ab",
    label: "Replay · Channel A+B",
    category: "Replay",
    text: "CH A+B",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "replay-select-channel-ab" }],
  },
  {
    id: "replay-swap",
    label: "Replay · Swap channels",
    category: "Replay",
    text: "SWAP",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-swap-channels" }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // VIDEO CALL — audio + video source
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "call-audio-source",
    label: "Video call · Audio source",
    category: "Video call",
    text: "CALL\nAUD",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "video-call-audio-source",
        options: { input: 1, source: "Master" },
      },
    ],
  },
  {
    id: "call-video-source",
    label: "Video call · Video source",
    category: "Video call",
    text: "CALL\nVID",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "video-call-video-source",
        options: { input: 1, source: "Output1" },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // vMix FUNCTIONS — global show controls
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "fn-stream-toggle",
    label: "Stream toggle",
    category: "vMix Functions",
    text: "STREAM",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "start-stop-streaming" }],
  },
  {
    id: "fn-record-toggle",
    label: "Record toggle",
    category: "vMix Functions",
    text: "REC",
    bgcolor: "#8e44ad",
    fgcolor: "#ffffff",
    steps: [{ actionId: "start-stop-recording" }],
  },
  {
    id: "fn-multicorder-start",
    label: "MultiCorder · Start",
    category: "vMix Functions",
    text: "MCORD\n▶",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "start-multi-corder" }],
  },
  {
    id: "fn-multicorder-stop",
    label: "MultiCorder · Stop",
    category: "vMix Functions",
    text: "MCORD\n■",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "stop-multi-corder" }],
  },
  {
    id: "fn-go-live",
    label: "Go Live (stream + record)",
    category: "vMix Functions",
    text: "GO LIVE",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "start-streaming" },
      { actionId: "start-recording" },
    ],
  },
  {
    id: "fn-end-show",
    label: "End show (stop stream + record)",
    category: "vMix Functions",
    text: "STOP",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [
      { actionId: "stop-streaming" },
      { actionId: "stop-recording" },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // PlayList automation (distinct from list-input nav)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "playlist-start",
    label: "PlayList · Start",
    category: "PlayList",
    text: "PLAY\nLIST",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "playlist-start" }],
  },
  {
    id: "playlist-stop",
    label: "PlayList · Stop",
    category: "PlayList",
    text: "STOP\nLIST",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "playlist-stop" }],
  },
  {
    id: "playlist-next",
    label: "PlayList · Next",
    category: "PlayList",
    text: "PL →",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "playlist-next" }],
  },
  {
    id: "playlist-prev",
    label: "PlayList · Previous",
    category: "PlayList",
    text: "PL ←",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "playlist-prev" }],
  },
  {
    id: "playlist-select",
    label: "PlayList · Select by name",
    category: "PlayList",
    text: "PL\nSEL",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "playlist-select", options: { value: "Show A" } }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Overlays — additional ops + global off
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "ovl-all-off",
    label: "All overlays off",
    category: "Overlays",
    text: "OVL\nALL OFF",
    bgcolor: "#000000",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "overlay-all-off" }],
  },
  {
    id: "ovl-last",
    label: "Overlay · Last (re-show last input)",
    category: "Overlays",
    text: "OVL\nLAST",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    // Default to OVL1 — operator picks the channel via the inspector
    // (no generic last-with-channel action exists; bind specific
    // overlay-N-last from the Actions tab for a different channel).
    steps: [{ actionId: "overlay-1-last" }],
  },
  {
    id: "ovl-prgm",
    label: "Overlay · Show on PROGRAM only",
    category: "Overlays",
    text: "OVL\nPRGM",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "overlay-1-prgm", options: { input: 1 } }],
  },
  {
    id: "ovl-prv",
    label: "Overlay · Show on PREVIEW only",
    category: "Overlays",
    text: "OVL\nPRV",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "overlay-1-prv", options: { input: 1 } }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Outputs — Replay routing
  // ═══════════════════════════════════════════════════════════════════
  ...[2, 3, 4].map(
    (n): PresetDefinition => ({
      id: `out-${n}-replay`,
      label: `Output ${n} ← Replay`,
      category: "Outputs",
      text: `OUT${n}\nRPLY`,
      bgcolor: "#8e44ad",
      fgcolor: "#ffffff",
      steps: [{ actionId: `out-${n}-replay` }],
    })
  ),

  // ═══════════════════════════════════════════════════════════════════
  // Functions — extra toggles (External, Fullscreen, FTB toggle)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "fn-external-toggle",
    label: "External output toggle",
    category: "vMix Functions",
    text: "EXT",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "toggle-external" }],
  },
  {
    id: "fn-fullscreen-toggle",
    label: "Fullscreen toggle",
    category: "vMix Functions",
    text: "FULL",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "toggle-fullscreen" }],
  },
  {
    id: "fn-fullscreen-2-toggle",
    label: "Fullscreen 2 toggle",
    category: "vMix Functions",
    text: "FULL 2",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "toggle-fullscreen-2" }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // T-slot configuration (reprogram GUI transition buttons live)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "config-tslot-effect",
    label: "Configure T-slot effect",
    category: "Transitions",
    text: "T-SLOT\nEFFECT",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "set-tslot-1-effect", options: { effect: "Fade" } }],
  },
  {
    id: "config-tslot-duration",
    label: "Configure T-slot duration",
    category: "Transitions",
    text: "T-SLOT\nDUR",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "set-tslot-1-duration", options: { duration: 500 } },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Replay events
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "replay-play-events",
    label: "Replay · Play events",
    category: "Replay",
    text: "▶ EVT",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-play-events" }],
  },
  {
    id: "replay-pause-events",
    label: "Replay · Pause events",
    category: "Replay",
    text: "⏸ EVT",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "replay-pause-events" }],
  },
  {
    id: "replay-play-events-by-id",
    label: "Replay · Play events by ID",
    category: "Replay",
    text: "▶ IDS",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "replay-play-events-by-id", options: { ids: "1" } }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Video input marks (in/out trim — distinct from list-item selects)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "video-mark-in",
    label: "Video · Mark In",
    category: "Video marks",
    text: "MARK\nIN",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "mark-in", options: { input: 1 } }],
  },
  {
    id: "video-mark-out",
    label: "Video · Mark Out",
    category: "Video marks",
    text: "MARK\nOUT",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "mark-out", options: { input: 1 } }],
  },
  {
    id: "video-clear-in-out",
    label: "Video · Clear In/Out",
    category: "Video marks",
    text: "CLR\nI/O",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "mark-clear-in-out", options: { input: 1 } }],
  },
  {
    id: "video-clear-in",
    label: "Video · Clear In",
    category: "Video marks",
    text: "CLR\nIN",
    bgcolor: "#1c1c1e",
    fgcolor: "#5ac8fa",
    steps: [{ actionId: "mark-clear-in", options: { input: 1 } }],
  },
  {
    id: "video-clear-out",
    label: "Video · Clear Out",
    category: "Video marks",
    text: "CLR\nOUT",
    bgcolor: "#1c1c1e",
    fgcolor: "#5ac8fa",
    steps: [{ actionId: "mark-clear-out", options: { input: 1 } }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Scripting & custom commands
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "script-start",
    label: "Script · Start",
    category: "Scripts",
    text: "SCRIPT\n▶",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "script-start", options: { value: "" } }],
  },
  {
    id: "script-stop",
    label: "Script · Stop",
    category: "Scripts",
    text: "SCRIPT\n■",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "script-stop", options: { value: "" } }],
  },
  {
    id: "script-stop-all",
    label: "Script · Stop all",
    category: "Scripts",
    text: "SCRIPT\nSTOP ALL",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "script-stop-all" }],
  },
  {
    id: "send-keys",
    label: "Send keys",
    category: "Scripts",
    text: "KEYS",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "send-keys", options: { value: "" } }],
  },
  {
    id: "custom-command",
    label: "Custom raw command",
    category: "Scripts",
    text: "CUSTOM",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "custom-command",
        options: { Function: "Cut", Input: "1", Mix: "0" },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // MultiView layers
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "mv-layer-toggle",
    label: "MultiView · Layer toggle",
    category: "MultiView",
    text: "MV\nTOG",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "multiview-layer-toggle", options: { input: 1, layer: 1 } },
    ],
  },
  {
    id: "mv-layer-on",
    label: "MultiView · Layer on",
    category: "MultiView",
    text: "MV\nON",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [
      { actionId: "multiview-layer-on", options: { input: 1, layer: 1 } },
    ],
  },
  {
    id: "mv-layer-off",
    label: "MultiView · Layer off",
    category: "MultiView",
    text: "MV\nOFF",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [
      { actionId: "multiview-layer-off", options: { input: 1, layer: 1 } },
    ],
  },
  {
    id: "mv-set-input",
    label: "MultiView · Set input on layer",
    category: "MultiView",
    text: "MV\nSRC",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "multiview-set-input",
        options: { input: 1, layer: 1, value: "2" },
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Title animations
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "title-anim-in",
    label: "Title · Transition in",
    category: "Titles",
    text: "T\nIN",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "title-no-flash", options: { input: 1 } }],
  },
  {
    id: "title-anim-continuous",
    label: "Title · Continuous animation",
    category: "Titles",
    text: "T\n∞",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "title-continuous", options: { input: 1 } }],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Audio presets (save / load / fade)
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "audio-preset-save",
    label: "Audio preset · Save",
    category: "Audio presets",
    text: "AUD\nSAVE",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "audio-preset-save" }],
  },
  {
    id: "audio-preset-load",
    label: "Audio preset · Load",
    category: "Audio presets",
    text: "AUD\nLOAD",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "audio-preset-load" }],
  },
  {
    id: "audio-preset-fade",
    label: "Audio preset · Fade",
    category: "Audio presets",
    text: "AUD\nFADE",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "audio-preset-fade" }],
  },
];
