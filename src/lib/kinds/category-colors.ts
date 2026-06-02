import type { ActionDefinition } from "@/lib/core/types";

/**
 * Single source of tile colours for EVERY module's actions.
 *
 * The unified browser builds one draggable tile per action (kinds ship no
 * 1:1 mirror presets — only genuine multi-step compound buttons stay as
 * presets). A tile needs a colour; rather than hand-paint hundreds of
 * actions across vMix/OBS/X32/grandMA/Ableton, we derive a stable colour
 * from the action's `category` here, in ONE place.
 *
 * Rule: a base colour is NEVER the reserved live-feedback red/green
 * (#ff3b30 / #34c759) — those mean "on program" / "on preview" at runtime
 * and must stay free to pop over any base.
 */

type Color = { bgcolor: string; fgcolor: string };

/** Neutral face for actions with no category (and the browser fallback). */
export const NEUTRAL_TILE: Color = { bgcolor: "#2c2c2e", fgcolor: "#dddddd" };

// A spread of distinct, legible hues — none red or green. A category maps
// to one of these deterministically, so the same category is always the
// same colour (within and across modules: "Audio" looks the same in OBS
// and X32).
const PALETTE: Color[] = [
  { bgcolor: "#0a84ff", fgcolor: "#ffffff" }, // blue
  { bgcolor: "#5ac8fa", fgcolor: "#000000" }, // cyan
  { bgcolor: "#5856d6", fgcolor: "#ffffff" }, // indigo
  { bgcolor: "#af52de", fgcolor: "#ffffff" }, // purple
  { bgcolor: "#bf5af2", fgcolor: "#ffffff" }, // magenta
  { bgcolor: "#ff9500", fgcolor: "#000000" }, // orange
  { bgcolor: "#ff9f0a", fgcolor: "#000000" }, // amber
  { bgcolor: "#64d2ff", fgcolor: "#000000" }, // light blue
  { bgcolor: "#ffd60a", fgcolor: "#000000" }, // yellow
  { bgcolor: "#c75ae0", fgcolor: "#ffffff" }, // violet
  { bgcolor: "#8e8e93", fgcolor: "#ffffff" }, // grey
  { bgcolor: "#48484a", fgcolor: "#ffffff" }, // slate
];

/** Stable colour for a category string (hash → palette slot). */
export function categoryColor(category?: string): Color {
  if (!category) return NEUTRAL_TILE;
  let h = 0;
  for (let i = 0; i < category.length; i++) {
    h = (h * 31 + category.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

/**
 * Fill in `bgcolor`/`fgcolor` (from the action's category) on any action
 * that doesn't already set its own. Kinds wire their catalog through this
 * so every synthesized browser tile is coloured without per-action work.
 */
export function withCategoryColors(
  actions: ActionDefinition[]
): ActionDefinition[] {
  return actions.map((a) =>
    a.bgcolor ? a : { ...a, ...categoryColor(a.category) }
  );
}
