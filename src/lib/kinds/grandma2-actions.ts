import type { ActionDefinition, ActionOption } from "@/lib/core/types";

/**
 * grandMA 2 command-line action catalog (sent over Telnet, port 30000).
 *
 * Every action emits a console command-line string wrapped as
 * `{ address: "/cmd", args: [string] }` — the telnet broker unwraps it
 * and writes the line. MA2 command-line syntax (vs MA3):
 *   • MA2 uses `Go Sequence N` (MA3 introduced `Go+ Sequence N`).
 *   • MA2's Goto syntax: `Goto Cue N Sequence M`.
 *   • Page change: `Page +` / `Page -` — same on both.
 *   • Macros: `Macro N Go` (MA2) vs `Macro N` (MA3).
 *   • Executors: `<verb> Executor <page>.<exec>` (no direct OSC fader).
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
const cmdString = (s: string): { address: string; args: [string] } => ({
  address: "/cmd",
  args: [s],
});

export const grandma2Actions: ActionDefinition[] = [
  // ════════════════════════ Command line ══════════════════════════════
  {
    id: "cmd",
    label: "Send command line",
    category: "Command line",
    description:
      "Execute any MA2 command-line string verbatim — e.g. `Go Sequence 5`.",
    options: [
      {
        id: "cmd",
        type: "string",
        label: "Command",
        placeholder: "Go Sequence 1",
      },
    ],
    toCommand: (o) => cmdString(String(o.cmd ?? "")),
  },

  // ════════════════════════ Sequences ═════════════════════════════════
  {
    id: "seq-go",
    label: "Sequence · Go",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Go Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "seq-go-back",
    label: "Sequence · Go back",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Go- Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "seq-pause",
    label: "Sequence · Pause",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Pause Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "seq-off",
    label: "Sequence · Off",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Off Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "seq-top",
    label: "Sequence · Top",
    category: "Sequences",
    options: [seqOpt],
    toCommand: (o) => cmdString(`Top Sequence ${(o.sequence as number) ?? 1}`),
  },

  // ════════════════════════ Cues ══════════════════════════════════════
  {
    id: "cue-goto",
    label: "Goto cue (in sequence)",
    category: "Cues",
    options: [seqOpt, cueOpt],
    toCommand: (o) =>
      cmdString(
        `Goto Cue ${(o.cue as number) ?? 1} Sequence ${(o.sequence as number) ?? 1}`
      ),
  },
  {
    id: "cue-first",
    label: "Goto first cue",
    category: "Cues",
    options: [seqOpt],
    toCommand: (o) =>
      cmdString(`Goto Cue 1 Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "cue-next",
    label: "Goto next cue",
    category: "Cues",
    options: [seqOpt],
    toCommand: (o) =>
      cmdString(`Goto Cue Next Sequence ${(o.sequence as number) ?? 1}`),
  },
  {
    id: "cue-prev",
    label: "Goto previous cue",
    category: "Cues",
    options: [seqOpt],
    toCommand: (o) =>
      cmdString(`Goto Cue Previous Sequence ${(o.sequence as number) ?? 1}`),
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

  // ════════════════════════ Executors (command line) ══════════════════
  // MA2 control is over Telnet command line, so executors are driven by
  // `<verb> Executor <page>.<exec>` rather than direct OSC fader paths.
  {
    id: "executor-go",
    label: "Executor · Go",
    category: "Executors",
    options: [pageOpt, execOpt],
    toCommand: (o) =>
      cmdString(`Go Executor ${(o.page as number) ?? 1}.${(o.exec as number) ?? 1}`),
  },
  {
    id: "executor-pause",
    label: "Executor · Pause",
    category: "Executors",
    options: [pageOpt, execOpt],
    toCommand: (o) =>
      cmdString(
        `Pause Executor ${(o.page as number) ?? 1}.${(o.exec as number) ?? 1}`
      ),
  },
  {
    id: "executor-off",
    label: "Executor · Off",
    category: "Executors",
    options: [pageOpt, execOpt],
    toCommand: (o) =>
      cmdString(`Off Executor ${(o.page as number) ?? 1}.${(o.exec as number) ?? 1}`),
  },

  // ════════════════════════ Macros ════════════════════════════════════
  {
    id: "macro-go",
    label: "Run macro",
    category: "Macros",
    description: "MA2 syntax: `Macro N Go`",
    options: [
      { id: "macro", type: "number", label: "Macro #", default: 1, min: 1 },
    ],
    toCommand: (o) => cmdString(`Macro ${(o.macro as number) ?? 1} Go`),
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
        label: "Preset pool #",
        default: "4",
        choices: [
          ["1", "Dimmer"],
          ["2", "Position"],
          ["3", "Gobo"],
          ["4", "Color"],
          ["5", "Beam"],
          ["6", "Focus"],
          ["7", "Control"],
          ["8", "Shapers"],
        ].map(([id, label]) => ({ id, label })),
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
      cmdString(`Preset ${o.type ?? "4"}.${(o.preset as number) ?? 1}`),
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
    toCommand: () => cmdString("Clear"),
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
    id: "store-cue",
    label: "Store · Cue",
    category: "Store",
    options: [seqOpt, cueOpt],
    toCommand: (o) =>
      cmdString(
        `Store Cue ${(o.cue as number) ?? 1} Sequence ${(o.sequence as number) ?? 1}`
      ),
  },
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
    id: "update",
    label: "Update active cue",
    category: "Store",
    toCommand: () => cmdString("Update"),
  },

  // ════════════════════════ Programmer ════════════════════════════════
  {
    id: "programmer-clear",
    label: "Programmer · Clear",
    category: "Programmer",
    toCommand: () => cmdString("Clear"),
  },
  {
    id: "programmer-off",
    label: "Programmer · Off",
    category: "Programmer",
    toCommand: () => cmdString("Off Programmer"),
  },
  {
    id: "programmer-highlight",
    label: "Programmer · Highlight",
    category: "Programmer",
    toCommand: () => cmdString("Highlt"),
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
    label: "Effect · Stomp",
    category: "Effects",
    toCommand: () => cmdString("Stomp"),
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

  // ════════════════════════ Global ════════════════════════════════════
  {
    id: "off-all",
    label: "Off everything",
    category: "Global",
    description: "Kills all running executors. MA2: `Off Executor Thru`.",
    toCommand: () => cmdString("Off Executor Thru"),
  },
  {
    id: "blackout",
    label: "Blackout (Grandmaster 0%)",
    category: "Global",
    toCommand: () => cmdString("Grandmaster 1 At 0"),
  },
  {
    id: "full",
    label: "Grandmaster 100%",
    category: "Global",
    toCommand: () => cmdString("Grandmaster 1 At 100"),
  },
  {
    id: "save-show",
    label: "Save show",
    category: "Global",
    toCommand: () => cmdString("SaveShow"),
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
        placeholder: "Go Sequence 5",
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
];
