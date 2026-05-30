import type { ActionDefinition, ActionOption } from "@/lib/core/types";

/**
 * X32 OSC action catalog. Each action builds an OSC command payload
 * `{ address: "/...", args: [...] }` that the X32 adapter forwards
 * over UDP. The X32 OSC paths used here come from the Behringer X32
 * OSC documentation.
 *
 * Coverage focuses on the operator-facing surface: channel/aux/bus/
 * matrix/main mutes + faders + names, scene navigation, USB recorder,
 * mute groups, talkback, and arbitrary OSC escape hatch for the rare
 * path that doesn't fit a curated action.
 */

// ─────────────────────────── Option fragments ─────────────────────────

const chanOpt: ActionOption = {
  id: "channel",
  type: "number",
  label: "Channel #",
  default: 1,
  min: 1,
  max: 32,
};
const busOpt: ActionOption = {
  id: "bus",
  type: "number",
  label: "Bus #",
  default: 1,
  min: 1,
  max: 16,
};
const auxOpt: ActionOption = {
  id: "aux",
  type: "number",
  label: "Aux #",
  default: 1,
  min: 1,
  max: 8,
};
const mtxOpt: ActionOption = {
  id: "matrix",
  type: "number",
  label: "Matrix #",
  default: 1,
  min: 1,
  max: 6,
};
const muteGroupOpt: ActionOption = {
  id: "group",
  type: "number",
  label: "Mute group #",
  default: 1,
  min: 1,
  max: 6,
};
const faderOpt: ActionOption = {
  id: "level",
  type: "number",
  label: "Fader (0..1)",
  default: 0.5,
  min: 0,
  max: 1,
  step: 0.01,
};
const muteValueOpt: ActionOption = {
  id: "muted",
  type: "boolean",
  label: "Muted",
  default: true,
};

const pad2 = (n: number) => String(n).padStart(2, "0");

// ─────────────────────────── Catalog ──────────────────────────────────

export const x32Actions: ActionDefinition[] = [
  // ════════════════════════ Channels (1-32) ═══════════════════════════
  {
    id: "ch-mute",
    label: "Channel mute",
    category: "Channels",
    options: [chanOpt, muteValueOpt],
    toCommand: (o) => ({
      address: `/ch/${pad2((o.channel as number) ?? 1)}/mix/on`,
      // X32 mute semantics inverted: on=1 means audible, on=0 means muted.
      args: [o.muted ? 0 : 1],
    }),
  },
  {
    id: "ch-mute-toggle",
    label: "Channel mute toggle",
    category: "Channels",
    description: "Sends `/ch/N/mix/on` with the inverted current value.",
    options: [chanOpt],
    // We can't read the current value without subscribing — but
    // sending `~` as a value triggers X32's toggle behaviour per the
    // OSC reference.
    toCommand: (o) => ({
      address: `/ch/${pad2((o.channel as number) ?? 1)}/mix/on`,
      args: ["~"],
    }),
  },
  {
    id: "ch-fader",
    label: "Channel fader",
    category: "Channels",
    options: [chanOpt, faderOpt],
    toCommand: (o) => ({
      address: `/ch/${pad2((o.channel as number) ?? 1)}/mix/fader`,
      args: [Number(o.level ?? 0.5)],
    }),
  },
  {
    id: "ch-name",
    label: "Channel name",
    category: "Channels",
    options: [
      chanOpt,
      { id: "name", type: "string", label: "Name", placeholder: "Vox 1" },
    ],
    toCommand: (o) => ({
      address: `/ch/${pad2((o.channel as number) ?? 1)}/config/name`,
      args: [String(o.name ?? "")],
    }),
  },
  {
    id: "ch-color",
    label: "Channel color",
    category: "Channels",
    options: [
      chanOpt,
      {
        id: "color",
        type: "dropdown",
        label: "Color",
        default: "1",
        choices: [
          { id: "0", label: "Off" },
          { id: "1", label: "Red" },
          { id: "2", label: "Green" },
          { id: "3", label: "Yellow" },
          { id: "4", label: "Blue" },
          { id: "5", label: "Magenta" },
          { id: "6", label: "Cyan" },
          { id: "7", label: "White" },
        ],
      },
    ],
    toCommand: (o) => ({
      address: `/ch/${pad2((o.channel as number) ?? 1)}/config/color`,
      args: [Number(o.color ?? 1)],
    }),
  },
  {
    id: "ch-solo",
    label: "Channel solo",
    category: "Channels",
    options: [chanOpt, { id: "solo", type: "boolean", label: "Solo", default: true }],
    // X32 solo lives under `/-stat/solosw/NN`.
    toCommand: (o) => ({
      address: `/-stat/solosw/${pad2((o.channel as number) ?? 1)}`,
      args: [o.solo ? 1 : 0],
    }),
  },
  {
    id: "ch-bus-send",
    label: "Channel → bus send level",
    category: "Channels",
    options: [chanOpt, busOpt, faderOpt],
    toCommand: (o) => ({
      address: `/ch/${pad2((o.channel as number) ?? 1)}/mix/${pad2(
        (o.bus as number) ?? 1
      )}/level`,
      args: [Number(o.level ?? 0.5)],
    }),
  },
  {
    id: "ch-bus-send-on",
    label: "Channel → bus send on/off",
    category: "Channels",
    options: [
      chanOpt,
      busOpt,
      { id: "enabled", type: "boolean", label: "Enabled", default: true },
    ],
    toCommand: (o) => ({
      address: `/ch/${pad2((o.channel as number) ?? 1)}/mix/${pad2(
        (o.bus as number) ?? 1
      )}/on`,
      args: [o.enabled ? 1 : 0],
    }),
  },

  // ════════════════════════ Buses (1-16) ══════════════════════════════
  {
    id: "bus-mute",
    label: "Bus mute",
    category: "Buses",
    options: [busOpt, muteValueOpt],
    toCommand: (o) => ({
      address: `/bus/${pad2((o.bus as number) ?? 1)}/mix/on`,
      args: [o.muted ? 0 : 1],
    }),
  },
  {
    id: "bus-fader",
    label: "Bus fader",
    category: "Buses",
    options: [busOpt, faderOpt],
    toCommand: (o) => ({
      address: `/bus/${pad2((o.bus as number) ?? 1)}/mix/fader`,
      args: [Number(o.level ?? 0.5)],
    }),
  },
  {
    id: "bus-name",
    label: "Bus name",
    category: "Buses",
    options: [busOpt, { id: "name", type: "string", label: "Name" }],
    toCommand: (o) => ({
      address: `/bus/${pad2((o.bus as number) ?? 1)}/config/name`,
      args: [String(o.name ?? "")],
    }),
  },

  // ════════════════════════ Aux (1-8) ═════════════════════════════════
  {
    id: "aux-mute",
    label: "Aux mute",
    category: "Aux",
    options: [auxOpt, muteValueOpt],
    toCommand: (o) => ({
      address: `/auxin/${pad2((o.aux as number) ?? 1)}/mix/on`,
      args: [o.muted ? 0 : 1],
    }),
  },
  {
    id: "aux-fader",
    label: "Aux fader",
    category: "Aux",
    options: [auxOpt, faderOpt],
    toCommand: (o) => ({
      address: `/auxin/${pad2((o.aux as number) ?? 1)}/mix/fader`,
      args: [Number(o.level ?? 0.5)],
    }),
  },

  // ════════════════════════ Matrix (1-6) ══════════════════════════════
  {
    id: "mtx-mute",
    label: "Matrix mute",
    category: "Matrix",
    options: [mtxOpt, muteValueOpt],
    toCommand: (o) => ({
      address: `/mtx/${pad2((o.matrix as number) ?? 1)}/mix/on`,
      args: [o.muted ? 0 : 1],
    }),
  },
  {
    id: "mtx-fader",
    label: "Matrix fader",
    category: "Matrix",
    options: [mtxOpt, faderOpt],
    toCommand: (o) => ({
      address: `/mtx/${pad2((o.matrix as number) ?? 1)}/mix/fader`,
      args: [Number(o.level ?? 0.5)],
    }),
  },

  // ════════════════════════ Main ══════════════════════════════════════
  {
    id: "main-fader",
    label: "Main LR fader",
    category: "Main",
    options: [faderOpt],
    toCommand: (o) => ({
      address: "/main/st/mix/fader",
      args: [Number(o.level ?? 0.5)],
    }),
  },
  {
    id: "main-mute",
    label: "Main LR mute",
    category: "Main",
    options: [muteValueOpt],
    toCommand: (o) => ({
      address: "/main/st/mix/on",
      args: [o.muted ? 0 : 1],
    }),
  },
  {
    id: "mono-fader",
    label: "Main mono fader",
    category: "Main",
    options: [faderOpt],
    toCommand: (o) => ({
      address: "/main/m/mix/fader",
      args: [Number(o.level ?? 0.5)],
    }),
  },
  {
    id: "mono-mute",
    label: "Main mono mute",
    category: "Main",
    options: [muteValueOpt],
    toCommand: (o) => ({
      address: "/main/m/mix/on",
      args: [o.muted ? 0 : 1],
    }),
  },

  // ════════════════════════ DCAs (1-8) ═════════════════════════════════
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
    {
      id: `dca-${n}-fader`,
      label: `DCA ${n} fader`,
      category: "DCAs",
      options: [faderOpt],
      toCommand: (o: Record<string, unknown>) => ({
        address: `/dca/${n}/fader`,
        args: [Number(o.level ?? 0.5)],
      }),
    } as ActionDefinition,
    {
      id: `dca-${n}-mute`,
      label: `DCA ${n} mute`,
      category: "DCAs",
      options: [muteValueOpt],
      toCommand: (o: Record<string, unknown>) => ({
        address: `/dca/${n}/on`,
        args: [o.muted ? 0 : 1],
      }),
    } as ActionDefinition,
    {
      id: `dca-${n}-name`,
      label: `DCA ${n} name`,
      category: "DCAs",
      options: [{ id: "name", type: "string", label: "Name" }],
      toCommand: (o: Record<string, unknown>) => ({
        address: `/dca/${n}/config/name`,
        args: [String(o.name ?? "")],
      }),
    } as ActionDefinition,
  ]),

  // ════════════════════════ Mute groups (1-6) ═════════════════════════
  {
    id: "mute-group-set",
    label: "Mute group state",
    category: "Mute groups",
    options: [
      muteGroupOpt,
      { id: "active", type: "boolean", label: "Active", default: true },
    ],
    toCommand: (o) => ({
      address: `/config/mute/${(o.group as number) ?? 1}`,
      args: [o.active ? 1 : 0],
    }),
  },

  // ════════════════════════ Scenes / cues ═════════════════════════════
  {
    id: "scene-load",
    label: "Load scene #",
    category: "Scenes",
    options: [
      {
        id: "scene",
        type: "number",
        label: "Scene index (0-99)",
        default: 0,
        min: 0,
        max: 99,
      },
    ],
    toCommand: (o) => ({
      address: "/-action/goscene",
      args: [Number(o.scene ?? 0)],
    }),
  },
  {
    id: "snippet-load",
    label: "Load snippet #",
    category: "Scenes",
    options: [
      {
        id: "snippet",
        type: "number",
        label: "Snippet index (0-99)",
        default: 0,
        min: 0,
        max: 99,
      },
    ],
    toCommand: (o) => ({
      address: "/-action/gosnippet",
      args: [Number(o.snippet ?? 0)],
    }),
  },
  {
    id: "cue-load",
    label: "Load cue #",
    category: "Scenes",
    options: [
      {
        id: "cue",
        type: "number",
        label: "Cue index (0-99)",
        default: 0,
        min: 0,
        max: 99,
      },
    ],
    toCommand: (o) => ({
      address: "/-action/gocue",
      args: [Number(o.cue ?? 0)],
    }),
  },
  {
    id: "next-cue",
    label: "Next cue",
    category: "Scenes",
    toCommand: () => ({ address: "/-action/cueinc", args: [1] }),
  },
  {
    id: "prev-cue",
    label: "Previous cue",
    category: "Scenes",
    toCommand: () => ({ address: "/-action/cueinc", args: [-1] }),
  },

  // ════════════════════════ USB recorder ══════════════════════════════
  {
    id: "usb-rec",
    label: "USB: record",
    category: "USB recorder",
    toCommand: () => ({ address: "/-stat/urec", args: [1] }),
  },
  {
    id: "usb-stop",
    label: "USB: stop",
    category: "USB recorder",
    toCommand: () => ({ address: "/-stat/urec", args: [0] }),
  },
  {
    id: "usb-play",
    label: "USB: play",
    category: "USB recorder",
    toCommand: () => ({ address: "/-stat/uplay", args: [1] }),
  },
  {
    id: "usb-pause",
    label: "USB: pause",
    category: "USB recorder",
    toCommand: () => ({ address: "/-stat/uplay", args: [0] }),
  },

  // ════════════════════════ Talkback ══════════════════════════════════
  {
    id: "talkback-a",
    label: "Talkback A toggle",
    category: "Talkback",
    toCommand: () => ({ address: "/-stat/talk/A", args: ["~"] }),
  },
  {
    id: "talkback-b",
    label: "Talkback B toggle",
    category: "Talkback",
    toCommand: () => ({ address: "/-stat/talk/B", args: ["~"] }),
  },

  // ════════════════════════ Raw OSC ═══════════════════════════════════
  {
    id: "raw",
    label: "Raw OSC",
    category: "Misc",
    description:
      "Send any OSC address with comma-separated args. Escape hatch for X32 paths this catalog doesn't cover.",
    options: [
      {
        id: "address",
        type: "string",
        label: "OSC address",
        placeholder: "/ch/01/mix/fader",
      },
      {
        id: "argsCsv",
        type: "string",
        label: "Args (CSV: 0.5,Hello,1)",
        placeholder: "0.5",
      },
    ],
    toCommand: (o) => {
      const csv = typeof o.argsCsv === "string" ? o.argsCsv : "";
      const args = csv
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
          const n = Number(s);
          return Number.isFinite(n) ? n : s;
        });
      return { address: String(o.address ?? "/"), args };
    },
  },

  // ════════════════════════ Channel inserts / processing ══════════════
  // Generic per-channel toggles for EQ / Gate / Compressor / Insert /
  // Low-cut. Channel picked in the inspector after drop. The X32 OSC
  // tree puts these under `/ch/NN/<section>/on`.
  ...(
    [
      ["eq", "preamp/hpon", "Low-cut"],
      ["gate", "gate/on", "Gate"],
      ["dyn", "dyn/on", "Compressor"],
      ["insert", "insert/on", "Insert"],
    ] as Array<[string, string, string]>
  ).flatMap(([key, path, label]) => [
    {
      id: `ch-${key}-on`,
      label: `Channel · ${label} on`,
      category: "Channel processing",
      options: [chanOpt],
      toCommand: (o: Record<string, unknown>) => ({
        address: `/ch/${pad2((o.channel as number) ?? 1)}/${path}`,
        args: [1],
      }),
    } as ActionDefinition,
    {
      id: `ch-${key}-off`,
      label: `Channel · ${label} off`,
      category: "Channel processing",
      options: [chanOpt],
      toCommand: (o: Record<string, unknown>) => ({
        address: `/ch/${pad2((o.channel as number) ?? 1)}/${path}`,
        args: [0],
      }),
    } as ActionDefinition,
    {
      id: `ch-${key}-toggle`,
      label: `Channel · ${label} toggle`,
      category: "Channel processing",
      options: [chanOpt],
      toCommand: (o: Record<string, unknown>) => ({
        address: `/ch/${pad2((o.channel as number) ?? 1)}/${path}`,
        args: ["~"],
      }),
    } as ActionDefinition,
  ]),

  // ════════════════════════ Channel EQ band ───────────────────────────
  // 4-band parametric — toggle each band on/off. Band index 1-4.
  {
    id: "ch-eq-band-toggle",
    label: "Channel · EQ band on/off",
    category: "Channel processing",
    options: [
      chanOpt,
      {
        id: "band",
        type: "dropdown",
        label: "Band",
        default: "1",
        choices: ["1", "2", "3", "4"].map((id) => ({ id, label: `Band ${id}` })),
      },
      { id: "enabled", type: "boolean", label: "Enabled", default: true },
    ],
    toCommand: (o) => ({
      address: `/ch/${pad2((o.channel as number) ?? 1)}/eq/${o.band ?? 1}/type`,
      // X32 quirk: setting type=0 (off) bypasses the band.
      args: [o.enabled ? 4 : 0],
    }),
  },

  // ════════════════════════ Head amp / preamp gain ────────────────────
  {
    id: "ch-preamp-gain",
    label: "Channel · Head amp gain (dB)",
    category: "Channels",
    options: [
      chanOpt,
      {
        id: "gain",
        type: "number",
        label: "Gain (dB)",
        default: 0,
        min: -12,
        max: 60,
        step: 0.5,
      },
    ],
    // The X32 head amp gain maps -12..+60 dB to a 0..1 OSC float.
    // Linear scaling is close enough for live use; matching the
    // exact gain curve isn't worth the complexity.
    toCommand: (o) => {
      const gain = Number(o.gain ?? 0);
      const normalized = Math.max(0, Math.min(1, (gain + 12) / 72));
      return {
        address: `/headamp/${pad2((o.channel as number) ?? 1)}/gain`,
        args: [normalized],
      };
    },
  },
  {
    id: "ch-phantom",
    label: "Channel · Phantom power 48V",
    category: "Channels",
    options: [
      chanOpt,
      { id: "enabled", type: "boolean", label: "On", default: true },
    ],
    toCommand: (o) => ({
      address: `/headamp/${pad2((o.channel as number) ?? 1)}/phantom`,
      args: [o.enabled ? 1 : 0],
    }),
  },

  // ════════════════════════ FX / tap tempo ════════════════════════════
  {
    id: "fx-tap",
    label: "FX · Tap tempo",
    category: "FX",
    description: "Taps the FX rack's tap-tempo button (typically routed to delays).",
    options: [
      {
        id: "slot",
        type: "dropdown",
        label: "FX slot",
        default: "1",
        choices: ["1", "2", "3", "4", "5", "6", "7", "8"].map((id) => ({
          id,
          label: `FX ${id}`,
        })),
      },
    ],
    // X32 doesn't expose a literal `tap` OSC path — the conventional
    // technique is to flip the FX bypass twice rapidly, which the
    // tap-aware effects sample as a tap. Operators with hardware
    // delays should fall back to the raw OSC escape hatch.
    toCommand: (o) => ({
      address: `/fx/${o.slot ?? 1}/source`,
      args: ["~"],
    }),
  },

  // ════════════════════════ Clear solo ════════════════════════════════
  {
    id: "clear-solo",
    label: "Clear solo (all)",
    category: "Solo",
    toCommand: () => ({ address: "/-stat/solo", args: [0] }),
  },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(
    (n): ActionDefinition => ({
      id: `bus-${n}-solo-toggle`,
      label: `Bus ${n} · Solo toggle`,
      category: "Solo",
      toCommand: () => ({
        address: `/-stat/solosw/${pad2(n + 40)}`,
        args: ["~"],
      }),
    })
  ),

  // ════════════════════════ Scene store ═══════════════════════════════
  {
    id: "scene-save",
    label: "Save current as scene #",
    category: "Scenes",
    options: [
      {
        id: "scene",
        type: "number",
        label: "Scene index (0-99)",
        default: 0,
        min: 0,
        max: 99,
      },
      {
        id: "name",
        type: "string",
        label: "Scene name",
        placeholder: "(optional)",
      },
    ],
    toCommand: (o) => ({
      address: "/-action/savescene",
      args: [Number(o.scene ?? 0), String(o.name ?? "")],
    }),
  },

  // ════════════════════════ Channel select (X-Live recall) ════════════
  {
    id: "select-channel",
    label: "Select channel (Sel button)",
    category: "Channels",
    options: [chanOpt],
    toCommand: (o) => ({
      address: "/-stat/selidx",
      args: [(((o.channel as number) ?? 1) - 1)],
    }),
  },
];
