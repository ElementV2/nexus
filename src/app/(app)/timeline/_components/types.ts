// Shared types for the Timeline / Live Show editor.

import type {
  Scenario,
  Track,
  TimelineClip,
  WaitMarker,
} from "@/lib/db/timeline";
import type { ActionCatalogEntry } from "@/app/(app)/streamdeck/_components/types";

export type { Scenario, Track, TimelineClip, WaitMarker, ActionCatalogEntry };

/** What the inspector is currently editing. */
export type Selection =
  | { kind: "clip"; trackId: string; clipId: string }
  | { kind: "wait"; waitId: string }
  | null;

/** dataTransfer MIME used when dragging an action from the palette onto a
 *  track lane. The payload is the action's global id ("vmix:cut"). */
export const ACTION_DND_MIME = "application/x-nexus-timeline-action";

/** Live transport snapshot streamed from `/api/timeline/transport`. */
export interface TransportSnapshot {
  scenarioId: string | null;
  state: "idle" | "playing" | "waiting" | "paused";
  playheadMs: number;
  durationMs: number;
  skipWaits: boolean;
  waitingAtMs: number | null;
}

/** Build the default option values for a freshly-dropped action, from its
 *  catalog definition — so a clip fires sanely before any editing. */
export function defaultOptions(
  entry: ActionCatalogEntry
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of entry.options ?? []) {
    if (o.default !== undefined) out[o.id] = o.default;
  }
  return out;
}

/** Resolve a step's FULL global id (`<kind>:<id>`), normalising a bare id via
 *  its `kind` — so catalog lookups match whether the step stored a bare or a
 *  full id (parity with the deck KeyInspector). */
export function stepGlobalId(step: {
  actionId: string;
  kind?: string;
}): string {
  if (step.actionId.includes(":")) return step.actionId;
  return step.kind ? `${step.kind}:${step.actionId}` : step.actionId;
}

/** Display label for a clip: explicit override, else the first action's
 *  label (+ "…" when it bundles more), else the raw id. */
export function clipLabel(
  clip: TimelineClip,
  actions: ActionCatalogEntry[] | null
): string {
  if (clip.label && clip.label.trim()) return clip.label;
  const first = clip.steps[0];
  if (!first) return "empty";
  const gid = stepGlobalId(first);
  const entry = actions?.find((a) => a.globalId === gid);
  const base = entry?.label ?? first.actionId;
  return clip.steps.length > 1 ? `${base} …` : base;
}

/** Tile colour for a clip: explicit override, else the first action's bg,
 *  else a neutral panel colour. */
export function clipColor(
  clip: TimelineClip,
  actions: ActionCatalogEntry[] | null
): string {
  if (clip.color && clip.color.trim()) return clip.color;
  const first = clip.steps[0];
  const entry = first
    ? actions?.find((a) => a.globalId === stepGlobalId(first))
    : null;
  return entry?.bgcolor ?? "#3a3a3c";
}

/** Format a millisecond offset as `m:ss.t` (tenths) for compact readouts. */
export function fmtTime(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const tenths = Math.floor((abs % 1000) / 100);
  return `${sign}${m}:${String(s).padStart(2, "0")}.${tenths}`;
}
