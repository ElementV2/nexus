import type { ActionDefinition, ActionOption } from "@/lib/core/types";

/**
 * grandMA3 OSC action catalog. Two surfaces:
 *
 *   • CommandLine — `/cmd <string>` runs any console command. Use
 *     this for cue / sequence / preset / page operations the operator
 *     would type at the MA3 command line. Catch-all powerful.
 *
 *   • Executor faders / buttons — `/<page>/<exec>` controls a single
 *     executor directly (faster, no command-line parsing).
 *
 * The MA3 OSC docs cover both. We expose curated entries for the
 * common operations + a raw command escape hatch.
 */

const pageOpt: ActionOption = {
  id: "page",
  type: "number",
  label: "Page #",
  default: 1,
  min: 1,
  max: 100,
};
const execOpt: ActionOption = {
  id: "exec",
  type: "number",
  label: "Executor #",
  default: 1,
  min: 1,
  max: 200,
};
const seqOpt: ActionOption = {
  id: "sequence",
  type: "number",
  label: "Sequence #",
  default: 1,
  min: 1,
};
const cueOpt: ActionOption = {
  id: "cue",
  type: "number",
  label: "Cue #",
  default: 1,
  min: 1,
};
const faderOpt: ActionOption = {
  id: "value",
  type: "number",
  label: "Value (0..1)",
  default: 1,
  min: 0,
  max: 1,
  step: 0.01,
};
const cmdString = (s: string): { address: string; args: [string] } => ({
  address: "/cmd",
  args: [s],
});

export const grandma3Actions: ActionDefinition[] = [
  // ════════════════════════ Command line ══════════════════════════════
  {
    id: "cmd",
    label: "Send command line",
    category: "Command line",
    description:
      "Execute any MA3 command-line string verbatim — e.g. `Go+ Sequence 5`.",
    options: [
      {
        id: "cmd",
        type: "string",
        label: "Command",
        placeholder: "Go+ Sequence 1",
      },
    ],
    toCommand: (o) => cmdString(String(o.cmd ?? "")),
  },

  // ════════════════════════ Sequences ═════════════════════════════════
  {
    id: "seq-go",
    label: "Sequence Go+",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Go+ Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "seq-go-back",
    label: "Sequence Go-",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Go- Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "seq-pause",
    label: "Sequence pause",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Pause Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "seq-off",
    label: "Sequence off",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Off Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "seq-top",
    label: "Sequence top",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Top Sequence ${(o.sequence as number) ?? 1}`),
  },

  // ════════════════════════ Cues ══════════════════════════════════════
  {
    id: "cue-go",
    label: "Cue Go (in sequence)",
    category: "Cues",
    options: [seqOpt, cueOpt],
    toCommand: (o) =>
      cmdString(
        `Goto Cue ${(o.cue as number) ?? 1} Sequence ${(o.sequence as number) ?? 1}`
      ),
  },
  {
    id: "cue-please",
    label: "Cue Please (in sequence)",
    category: "Cues",
    options: [seqOpt, cueOpt],
    toCommand: (o) =>
      cmdString(
        `Cue ${(o.cue as number) ?? 1} Sequence ${(o.sequence as number) ?? 1} Please`
      ),
  },

  // ════════════════════════ Pages ═════════════════════════════════════
  {
    id: "page-select",
    label: "Select executor page",
    category: "Pages",
    options: [pageOpt],
    toCommand: (o) => cmdString(`Page ${(o.page as number) ?? 1}`),
  },
  {
    id: "page-next",
    label: "Next page",
    category: "Pages",
    toCommand: () => cmdString("Page +"),
  },
  {
    id: "page-prev",
    label: "Previous page",
    category: "Pages",
    toCommand: () => cmdString("Page -"),
  },

  // ════════════════════════ Executors (direct OSC) ════════════════════
  {
    id: "executor-fader",
    label: "Executor fader value",
    category: "Executors",
    description: "Sets the fader of the given page/executor directly.",
    options: [pageOpt, execOpt, faderOpt],
    toCommand: (o) => ({
      address: `/Page${(o.page as number) ?? 1}/Fader${
        (o.exec as number) ?? 1
      }`,
      args: [Number(o.value ?? 1)],
    }),
  },
  {
    id: "executor-key",
    label: "Executor key (button press)",
    category: "Executors",
    options: [
      pageOpt,
      execOpt,
      {
        id: "key",
        type: "dropdown",
        label: "Key",
        default: "Key1",
        choices: [
          { id: "Key1", label: "Key 1" },
          { id: "Key2", label: "Key 2" },
          { id: "Key3", label: "Key 3" },
        ],
      },
      {
        id: "state",
        type: "dropdown",
        label: "Press / Release",
        default: "1",
        choices: [
          { id: "1", label: "Press (down)" },
          { id: "0", label: "Release (up)" },
        ],
      },
    ],
    toCommand: (o) => ({
      address: `/Page${(o.page as number) ?? 1}/${o.key ?? "Key1"}${
        (o.exec as number) ?? 1
      }`,
      args: [Number(o.state ?? 1)],
    }),
  },

  // ════════════════════════ Macros ════════════════════════════════════
  {
    id: "macro-run",
    label: "Run macro",
    category: "Macros",
    options: [
      { id: "macro", type: "number", label: "Macro #", default: 1, min: 1 },
    ],
    toCommand: (o) => cmdString(`Macro ${(o.macro as number) ?? 1}`),
  },

  // ════════════════════════ Presets ═══════════════════════════════════
  {
    id: "preset-call",
    label: "Call preset",
    category: "Presets",
    options: [
      {
        id: "type",
        type: "dropdown",
        label: "Preset pool",
        default: "Color",
        choices: [
          "Dimmer",
          "Position",
          "Gobo",
          "Color",
          "Beam",
          "Focus",
          "Control",
          "Shapers",
          "Video",
        ].map((id) => ({ id, label: id })),
      },
      {
        id: "preset",
        type: "number",
        label: "Preset #",
        default: 1,
        min: 1,
      },
    ],
    toCommand: (o) =>
      cmdString(`Preset "${o.type ?? "Color"}" ${(o.preset as number) ?? 1}`),
  },

  // ════════════════════════ Global ════════════════════════════════════
  {
    id: "off-all",
    label: "Off everything",
    category: "Global",
    description: "Kills all running executors. Equivalent to `Off Thru`.",
    toCommand: () => cmdString("Off Thru"),
  },
  {
    id: "blackout",
    label: "Blackout (Grandmaster 0%)",
    category: "Global",
    toCommand: () => cmdString("Master 0"),
  },
  {
    id: "full",
    label: "Grandmaster 100%",
    category: "Global",
    toCommand: () => cmdString("Master 100"),
  },
  {
    id: "release",
    label: "Release programmer",
    category: "Global",
    toCommand: () => cmdString("ClearAll"),
  },

  // ════════════════════════ Raw OSC ═══════════════════════════════════
  {
    id: "raw",
    label: "Raw OSC",
    category: "Misc",
    description:
      "Send any OSC address with CSV args. Escape hatch for paths this catalog doesn't cover.",
    options: [
      { id: "address", type: "string", label: "OSC address", placeholder: "/cmd" },
      {
        id: "argsCsv",
        type: "string",
        label: "Args (CSV)",
        placeholder: "Go+ Sequence 5",
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

  // ════════════════════════ Cue navigation ════════════════════════════
  {
    id: "cue-first",
    label: "Go to first cue",
    category: "Cues",
    options: [seqOpt],
    toCommand: (o) =>
      cmdString(`Goto Cue 1 Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "cue-last",
    label: "Go to last cue",
    category: "Cues",
    options: [seqOpt],
    toCommand: (o) =>
      cmdString(`Goto Cue Thru Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "cue-next",
    label: "Go to next cue",
    category: "Cues",
    options: [seqOpt],
    toCommand: (o) =>
      cmdString(`Goto Cue Next Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "cue-prev",
    label: "Go to previous cue",
    category: "Cues",
    options: [seqOpt],
    toCommand: (o) =>
      cmdString(`Goto Cue Previous Sequence ${(o.sequence as number) ?? 1}`),
  },

  // ════════════════════════ Programmer ════════════════════════════════
  {
    id: "programmer-clear",
    label: "Programmer · Clear",
    category: "Programmer",
    toCommand: () => cmdString("ClearAll"),
  },
  {
    id: "programmer-off",
    label: "Programmer · Off Programmer",
    category: "Programmer",
    toCommand: () => cmdString("Off Programmer"),
  },
  {
    id: "programmer-highlight",
    label: "Programmer · Highlight toggle",
    category: "Programmer",
    toCommand: () => cmdString("Highlt"),
  },
  {
    id: "programmer-store",
    label: "Programmer · Store cue",
    category: "Programmer",
    options: [seqOpt, cueOpt],
    toCommand: (o) =>
      cmdString(
        `Store Cue ${(o.cue as number) ?? 1} Sequence ${(o.sequence as number) ?? 1}`
      ),
  },
  {
    id: "programmer-store-merge",
    label: "Programmer · Store merge",
    category: "Programmer",
    options: [seqOpt, cueOpt],
    toCommand: (o) =>
      cmdString(
        `Store /m Cue ${(o.cue as number) ?? 1} Sequence ${(o.sequence as number) ?? 1}`
      ),
  },
  {
    id: "programmer-update",
    label: "Programmer · Update active cue",
    category: "Programmer",
    toCommand: () => cmdString("Update"),
  },

  // ════════════════════════ Selection / Fixtures ══════════════════════
  {
    id: "select-fixture",
    label: "Select fixture",
    category: "Selection",
    options: [
      { id: "fixture", type: "number", label: "Fixture #", default: 1, min: 1 },
    ],
    toCommand: (o) => cmdString(`Fixture ${(o.fixture as number) ?? 1}`),
  },
  {
    id: "select-fixture-range",
    label: "Select fixture range",
    category: "Selection",
    options: [
      { id: "from", type: "number", label: "From #", default: 1, min: 1 },
      { id: "to", type: "number", label: "To #", default: 8, min: 1 },
    ],
    toCommand: (o) =>
      cmdString(
        `Fixture ${(o.from as number) ?? 1} Thru ${(o.to as number) ?? 8}`
      ),
  },
  {
    id: "select-group",
    label: "Select group",
    category: "Selection",
    options: [
      { id: "group", type: "number", label: "Group #", default: 1, min: 1 },
    ],
    toCommand: (o) => cmdString(`Group ${(o.group as number) ?? 1}`),
  },
  {
    id: "selection-clear",
    label: "Clear selection",
    category: "Selection",
    toCommand: () => cmdString("ClearSelection"),
  },
  {
    id: "selection-next",
    label: "Selection · Next",
    category: "Selection",
    toCommand: () => cmdString("Next"),
  },
  {
    id: "selection-prev",
    label: "Selection · Previous",
    category: "Selection",
    toCommand: () => cmdString("Previous"),
  },

  // ════════════════════════ Stores ════════════════════════════════════
  {
    id: "store-group",
    label: "Store · Group",
    category: "Store",
    options: [
      { id: "group", type: "number", label: "Group #", default: 1, min: 1 },
    ],
    toCommand: (o) => cmdString(`Store Group ${(o.group as number) ?? 1}`),
  },
  {
    id: "store-preset",
    label: "Store · Preset",
    category: "Store",
    options: [
      {
        id: "type",
        type: "dropdown",
        label: "Preset pool",
        default: "Color",
        choices: [
          "Dimmer",
          "Position",
          "Gobo",
          "Color",
          "Beam",
          "Focus",
          "Control",
          "Shapers",
          "Video",
        ].map((id) => ({ id, label: id })),
      },
      { id: "preset", type: "number", label: "Preset #", default: 1, min: 1 },
    ],
    toCommand: (o) =>
      cmdString(
        `Store Preset "${o.type ?? "Color"}" ${(o.preset as number) ?? 1}`
      ),
  },
  {
    id: "store-executor",
    label: "Store · Executor",
    category: "Store",
    options: [pageOpt, execOpt],
    toCommand: (o) =>
      cmdString(
        `Store Executor ${(o.exec as number) ?? 1}.${(o.page as number) ?? 1}`
      ),
  },

  // ════════════════════════ Effects ═══════════════════════════════════
  {
    id: "effect-call",
    label: "Effect · Call",
    category: "Effects",
    options: [
      { id: "effect", type: "number", label: "Effect #", default: 1, min: 1 },
    ],
    toCommand: (o) => cmdString(`Effect ${(o.effect as number) ?? 1}`),
  },
  {
    id: "effect-off",
    label: "Effect · Off",
    category: "Effects",
    options: [
      { id: "effect", type: "number", label: "Effect #", default: 1, min: 1 },
    ],
    toCommand: (o) => cmdString(`Off Effect ${(o.effect as number) ?? 1}`),
  },
  {
    id: "effect-stomp",
    label: "Effect · Stomp (kill running)",
    category: "Effects",
    toCommand: () => cmdString("Stomp"),
  },

  // ════════════════════════ Special masters ═══════════════════════════
  {
    id: "submaster-set",
    label: "Submaster · Set level",
    category: "Masters",
    options: [
      {
        id: "master",
        type: "number",
        label: "Master #",
        default: 1,
        min: 1,
        max: 15,
      },
      {
        id: "value",
        type: "number",
        label: "Value (0-100)",
        default: 100,
        min: 0,
        max: 100,
      },
    ],
    toCommand: (o) =>
      cmdString(
        `SpecialMaster ${(o.master as number) ?? 1} At ${(o.value as number) ?? 100}`
      ),
  },
  {
    id: "ratemaster-toggle",
    label: "Rate master · Toggle",
    category: "Masters",
    toCommand: () => cmdString("SpecialMaster 4 At 100"),
  },

  // ════════════════════════ Views ═════════════════════════════════════
  {
    id: "view-load",
    label: "View · Load",
    category: "Views",
    options: [
      { id: "view", type: "number", label: "View #", default: 1, min: 1 },
    ],
    toCommand: (o) => cmdString(`View ${(o.view as number) ?? 1}`),
  },
  {
    id: "view-next",
    label: "View · Next",
    category: "Views",
    toCommand: () => cmdString("View +"),
  },
  {
    id: "view-prev",
    label: "View · Previous",
    category: "Views",
    toCommand: () => cmdString("View -"),
  },

  // ════════════════════════ Save show ═════════════════════════════════
  {
    id: "save-show",
    label: "Save show file",
    category: "Global",
    toCommand: () => cmdString("SaveShow"),
  },
];
