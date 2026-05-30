import type { ActionDefinition, ActionOption, PresetDefinition } from "@/lib/core/types";
import {
  VMIX_SHORTCUTS,
  type VmixCategory,
  type VmixParamId,
  type VmixShortcut,
} from "@/lib/vmix/shortcuts";

/**
 * Full vMix coverage, generated from the shortcut reference.
 *
 * `src/lib/vmix/shortcuts.ts` is the scraped source of truth for every
 * documented vMix Function (numbered/lettered families already condensed
 * into one templated entry, e.g. `OverlayInput{ch}` covers 1..4,
 * `SetBus{bus}Volume` covers A..G). Here we turn each entry into ONE
 * ActionDefinition + ONE PresetDefinition so the operator gets every vMix
 * command in the preset browser WITHOUT 700 near-duplicate tiles: a family
 * becomes a single preset whose placeholder (overlay #, bus, …) is an
 * option picker alongside Input / Value / etc.
 *
 * These augment the hand-curated `vmixActions` / `vmixPresets` (the
 * common, nicely-styled tiles). Generated ids are namespaced `sc-…` so
 * they never collide with the curated ones.
 */

// vMix's NAMED transition functions (Cut, Fade, Wipe, …) are NOT in the
// scraped ShortcutFunctionReference — it documents CutDirect / FadeToBlack /
// Transition{slot} but not the named transitions, even though they're the
// single most-used switching commands. Add them so the generated catalog is
// genuinely complete (the curated tiles, now removed, relied on these). All
// take Input + Duration + Mix; Cut takes no duration.
const EXTRA_TRANSITIONS: VmixShortcut[] = [
  { fn: "Cut", category: "Transition", description: "Cut the selected Input to Output on a mix", params: ["input", "mix"] },
  { fn: "Fade", category: "Transition", description: "Fade (Mix) transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "Merge", category: "Transition", description: "Merge transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "Wipe", category: "Transition", description: "Wipe transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "Slide", category: "Transition", description: "Slide transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "Fly", category: "Transition", description: "Fly transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "FlyRotate", category: "Transition", description: "Fly Rotate transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "Zoom", category: "Transition", description: "Zoom transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "CrossZoom", category: "Transition", description: "Cross Zoom transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "Cube", category: "Transition", description: "Cube transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "CubeZoom", category: "Transition", description: "Cube Zoom transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
  { fn: "AlphaFade", category: "Transition", description: "Alpha (key) fade transition. Duration = milliseconds", params: ["input", "duration", "mix"] },
];

const ALL_SHORTCUTS: VmixShortcut[] = [...VMIX_SHORTCUTS, ...EXTRA_TRANSITIONS];

// vMix query-string key for each documented param (besides family
// placeholders, which are baked into the Function NAME).
const PARAM_KEY: Record<VmixParamId, string> = {
  input: "Input",
  value: "Value",
  duration: "Duration",
  channel: "Channel",
  mix: "Mix",
  selectedIndex: "SelectedIndex",
  selectedName: "SelectedName",
};

/** The editor option fragment for each documented param. */
function paramOption(p: VmixParamId, description: string): ActionOption {
  switch (p) {
    case "input":
      return {
        id: "input",
        type: "string",
        label: "Input",
        default: "1",
        placeholder: "Number, title, or UUID",
      };
    case "value":
      return {
        id: "value",
        type: "string",
        label: "Value",
        // The reference usually documents the expected value after
        // "Value =" — surface it as the field tooltip.
        tooltip: description || undefined,
      };
    case "duration":
      return {
        id: "duration",
        type: "number",
        label: "Duration (ms)",
        default: 500,
        min: 0,
        max: 600000,
        step: 50,
      };
    case "channel":
      return {
        id: "channel",
        type: "number",
        label: "Channel",
        default: 1,
        min: 1,
        max: 8,
      };
    case "mix":
      return { id: "mix", type: "number", label: "Mix #", default: 1, min: 1, max: 4 };
    case "selectedIndex":
      return {
        id: "selectedIndex",
        type: "number",
        label: "Selected index",
        default: 1,
        min: 0,
      };
    case "selectedName":
      return { id: "selectedName", type: "string", label: "Selected name" };
  }
}

/** The editor option fragment for a condensed family placeholder. */
function familyOptions(s: VmixShortcut): ActionOption[] {
  return (s.family ?? []).map((f): ActionOption => {
    if (f.kind === "int") {
      return {
        id: f.id,
        type: "number",
        label: f.label ?? f.id,
        default: f.min,
        min: f.min,
        max: f.max,
      };
    }
    return {
      id: f.id,
      type: "dropdown",
      label: f.label ?? f.id,
      default: f.values[0],
      choices: f.values.map((v) => ({ id: v, label: v })),
    };
  });
}

/** "SetBus{bus}Volume" → "Set Bus Volume" (placeholder dropped, camelCase split). */
function humanize(fn: string): string {
  return fn
    .replace(/\{[^}]+\}/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function actionId(fn: string): string {
  return (
    "sc-" +
    fn
      .replace(/\{[^}]+\}/g, "") // drop the whole {placeholder}, not just braces
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

function buildToCommand(s: VmixShortcut): ActionDefinition["toCommand"] {
  const fams = s.family ?? [];
  return (options: Record<string, unknown>) => {
    let fnName = s.fn;
    for (const f of fams) {
      const raw = options[f.id];
      const v = raw === undefined || raw === "" ? defaultFamily(f) : raw;
      fnName = fnName.replace(`{${f.id}}`, String(v));
    }
    const body: Record<string, unknown> = { Function: fnName };
    for (const p of s.params) {
      const v = options[p];
      if (v !== undefined && v !== "") body[PARAM_KEY[p]] = v;
    }
    return body;
  };
}

function defaultFamily(f: NonNullable<VmixShortcut["family"]>[number]): string | number {
  return f.kind === "int" ? f.min : f.values[0];
}

// ── Colours ────────────────────────────────────────────────────────────
// The hand-tuned semantic colours from the (now-removed) curated tiles,
// keyed by the vMix Function they fire. A generated preset whose default
// Function matches picks it up; everything else falls back to a per-category
// accent so no tile is colourless.
type Color = { bgcolor?: string; fgcolor?: string };

const RED: Color = { bgcolor: "#ff3b30", fgcolor: "#ffffff" }; // PGM / cut
const GREEN: Color = { bgcolor: "#34c759", fgcolor: "#000000" }; // preview
const ORANGE: Color = { bgcolor: "#ff9500", fgcolor: "#000000" }; // fade / merge
const BLUE: Color = { bgcolor: "#5ac8fa", fgcolor: "#000000" }; // motion wipes
const INDIGO: Color = { bgcolor: "#5856d6", fgcolor: "#ffffff" }; // alpha / slot
const PURPLE: Color = { bgcolor: "#af52de", fgcolor: "#ffffff" }; // stinger
const BLACK: Color = { bgcolor: "#000000", fgcolor: "#ffffff" }; // FTB

const CURATED_COLOR_BY_FN: Record<string, Color> = {
  Cut: RED,
  PreviewInput: GREEN,
  Fade: ORANGE,
  Merge: ORANGE,
  Wipe: BLUE,
  Slide: BLUE,
  Fly: BLUE,
  FlyRotate: BLUE,
  Zoom: BLUE,
  CrossZoom: BLUE,
  Cube: BLUE,
  CubeZoom: BLUE,
  AlphaFade: INDIGO,
  Stinger1: PURPLE,
  Stinger2: PURPLE,
  Stinger3: PURPLE,
  Stinger4: PURPLE,
  Transition1: INDIGO,
  Transition2: INDIGO,
  Transition3: INDIGO,
  Transition4: INDIGO,
  FadeToBlack: BLACK,
  CutDirect: RED,
};

const CATEGORY_COLOR: Record<VmixCategory, Color> = {
  General: { bgcolor: "#48484a", fgcolor: "#ffffff" },
  Audio: { bgcolor: "#30c7a0", fgcolor: "#000000" },
  Transition: { bgcolor: "#ff9500", fgcolor: "#000000" },
  Output: { bgcolor: "#5ac8fa", fgcolor: "#000000" },
  Title: { bgcolor: "#af52de", fgcolor: "#ffffff" },
  Input: { bgcolor: "#0a84ff", fgcolor: "#ffffff" },
  Overlay: { bgcolor: "#5856d6", fgcolor: "#ffffff" },
  PlayList: { bgcolor: "#ff9f0a", fgcolor: "#000000" },
  Scripting: { bgcolor: "#8e8e93", fgcolor: "#ffffff" },
  Replay: { bgcolor: "#ff375f", fgcolor: "#ffffff" },
  NDI: { bgcolor: "#bf5af2", fgcolor: "#ffffff" },
  PTZ: { bgcolor: "#64d2ff", fgcolor: "#000000" },
  Preset: { bgcolor: "#636366", fgcolor: "#ffffff" },
  DataSources: { bgcolor: "#636366", fgcolor: "#ffffff" },
  Browser: { bgcolor: "#636366", fgcolor: "#ffffff" },
};

function build(): {
  actions: ActionDefinition[];
  presets: PresetDefinition[];
} {
  const actions: ActionDefinition[] = [];
  const presets: PresetDefinition[] = [];
  const seen = new Set<string>();

  for (const s of ALL_SHORTCUTS) {
    let id = actionId(s.fn);
    // Defensive dedupe — fn names are unique, but two templates could
    // collapse to the same id once braces are stripped.
    if (seen.has(id)) {
      let i = 2;
      while (seen.has(`${id}-${i}`)) i++;
      id = `${id}-${i}`;
    }
    seen.add(id);

    const options: ActionOption[] = [
      ...familyOptions(s),
      ...s.params.map((p) => paramOption(p, s.description)),
    ];
    const label = humanize(s.fn);
    const toCommand = buildToCommand(s);

    actions.push({
      id,
      label,
      category: s.category,
      description: s.description || undefined,
      options: options.length ? options : undefined,
      toCommand,
    });

    // Default option values for the dropped preset.
    const defaults: Record<string, unknown> = {};
    for (const o of options) {
      if (o.default !== undefined) defaults[o.id] = o.default;
    }
    // Colour: inherit the curated tile's colour for the same vMix Function
    // (resolved with default options), else fall back to a category accent.
    const fn = (toCommand(defaults) as { Function?: string }).Function ?? "";
    const color = CURATED_COLOR_BY_FN[fn] ?? CATEGORY_COLOR[s.category];
    presets.push({
      id,
      label,
      category: `vMix · ${s.category}`,
      text: label,
      bgcolor: color.bgcolor,
      fgcolor: color.fgcolor,
      steps: [{ actionId: id, options: defaults }],
    });
  }

  return { actions, presets };
}

const generated = build();

export const vmixShortcutActions: ActionDefinition[] = generated.actions;
export const vmixShortcutPresets: PresetDefinition[] = generated.presets;
