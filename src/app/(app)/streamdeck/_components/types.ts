// Shared types for the Stream Deck editor and its extracted components.

import type { DeckLayout } from "@/lib/db/streamdeck";

export interface DriverStatus {
  state: "deps-missing" | "ready" | "error";
  reason?: string;
  devicesKnown?: number;
}

export interface DeviceSummary {
  path: string;
  serialNumber?: string;
  model: string;
  opened: boolean;
  rows?: number;
  cols?: number;
  iconSize?: number;
  /** True for decks bridged by a nexus-cross satellite (on another PC). */
  remote?: boolean;
  /** Friendly label the satellite announced — the name typed in
   *  nexus-cross. Shown next to the deck so the operator can tell which
   *  machine it's on. */
  satelliteLabel?: string;
}

export interface DevicesResponse {
  status: DriverStatus;
  devices: DeviceSummary[];
}

export interface LayoutsResponse {
  layouts: DeckLayout[];
  geometries: Record<string, import("@/lib/db/streamdeck").DeckGeometry>;
}

export interface PresetPayload {
  globalId: string;
  kind: string;
  id: string;
  label: string;
  text?: string;
  bgcolor?: string;
  fgcolor?: string;
  steps: Array<{ actionId: string; options?: Record<string, unknown> }>;
}

export type FireState =
  | { kind: "idle" }
  | { kind: "running"; keyIndex: number }
  | { kind: "ok"; keyIndex: number }
  | { kind: "err"; keyIndex: number; error: string };

export const FIRE_FEEDBACK_MS = 1500;
export const FIRE_ERROR_MS = 3000;

// ─────────────────── Export / import shapes ───────────────────────────

/** A connection a layout references, captured so an import on another
 *  machine can remap it to a local connection. */
export interface DeckExportConnRef {
  id: string;
  kind: string;
  label: string;
}

export interface DeckExportFile {
  type: "nexus-deck";
  version: number;
  exportedAt?: string;
  layouts: DeckLayout[];
  /** Connections referenced by the exported layouts (for remap UI). */
  connections: DeckExportConnRef[];
}

// ─────────────────── Inspector / action catalog ───────────────────────

export interface ActionOptionDef {
  id: string;
  type: "number" | "string" | "boolean" | "dropdown";
  label: string;
  default?: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  choices?: Array<{ id: string; label: string }>;
  /** Show only when another option currently equals this value (e.g.
   *  SetOutput's Input field appears only when Value = "Input"). */
  showWhen?: { option: string; equals: string };
}

export interface ActionCatalogEntry {
  globalId: string;
  kind: string;
  id: string;
  label: string;
  options: ActionOptionDef[];
}

/** Minimal connection shape the inspector needs for its target
 *  pickers — id/kind/label/enabled. */
export interface ConnectionLite {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
}
