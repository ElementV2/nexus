"use client";

import { useEffect, useState } from "react";
import type { DeckBinding, DeckStep } from "@/lib/db/streamdeck";
import type { TimelineClip } from "@/lib/db/timeline";

/**
 * Cross-surface clipboard, shared between the Stream Deck editor and the
 * Live Show timeline. Each page used to keep its own in-React clipboard, so
 * a button copied on /streamdeck couldn't be pasted on /timeline. This is a
 * single module-level store (mirrored to localStorage so it survives a
 * reload) that BOTH pages read/write — with conversions so a multi-action
 * deck button becomes timeline clips and vice-versa.
 *
 * Same-surface paste stays LOSSLESS: a deck→deck paste reuses the binding
 * verbatim, a show→show paste reuses the clip. Only a cross-surface paste
 * runs a conversion (see `bindingToClips` / `clipToBinding`).
 */

export type SurfaceClipboard =
  | { v: 1; kind: "deck"; binding: DeckBinding }
  /** `trackId` is the track the clip was copied from, so a show→show paste
   *  can land on the same lane. Ignored by a deck paste. */
  | { v: 1; kind: "show"; clip: TimelineClip; trackId: string };

const LS_KEY = "nexus.surface-clipboard.v1";

let current: SurfaceClipboard | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function load(): SurfaceClipboard | null {
  if (current || loaded) return current;
  loaded = true;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) current = JSON.parse(raw) as SurfaceClipboard;
  } catch {
    /* corrupt / unavailable — ignore */
  }
  return current;
}

export function writeSurfaceClipboard(c: SurfaceClipboard): void {
  current = c;
  loaded = true;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(c));
    } catch {
      /* private mode / quota — in-memory still works this session */
    }
  }
  listeners.forEach((l) => l());
}

export function readSurfaceClipboard(): SurfaceClipboard | null {
  return load();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Pick up copies made in another tab.
  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_KEY) {
      current = null;
      loaded = false;
      cb();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}

/** Reactively track whether the shared clipboard has content (for enabling
 *  paste affordances). SSR-safe: null on first render, hydrates in effect. */
export function useSurfaceClipboard(): SurfaceClipboard | null {
  const [clip, setClip] = useState<SurfaceClipboard | null>(null);
  useEffect(() => {
    // One-time hydration from the module store (SSR rendered null); then
    // follow changes. eslint-disable: the initial sync read is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClip(readSurfaceClipboard());
    return subscribe(() => setClip(readSurfaceClipboard()));
  }, []);
  return clip;
}

// ─────────────────────────── conversions ──────────────────────────────

function hasPrefix(actionId: string): boolean {
  return actionId.includes(":");
}

function prefixOf(actionId: string): string {
  return actionId.slice(0, actionId.indexOf(":"));
}

function bareId(actionId: string): string {
  return actionId.includes(":")
    ? actionId.slice(actionId.indexOf(":") + 1)
    : actionId;
}

function stepKind(step: DeckStep): string {
  return (
    step.kind ??
    (step.actionId.includes(":")
      ? step.actionId.slice(0, step.actionId.indexOf(":"))
      : "")
  );
}

function genId(prefix: string): string {
  const r =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${r}`;
}

/** Face fields the catalog (or a curated preset) supplies for an action —
 *  so a pasted clip/button looks identical to dropping that action fresh. */
export interface ActionFace {
  label?: string;
  bgcolor?: string;
  fgcolor?: string;
}

/**
 * Deck button → ONE timeline clip at `atMs`. A clip and a button share the
 * same model (a list of actions), so a multi-action shortcut maps to a single
 * multi-action clip — NOT one clip per action. Internal delays stay as steps
 * inside the clip (they fire sequentially when the clip triggers, exactly like
 * an in-button delay).
 *
 * Each step is normalised to a FULL global id (`<kind>:<id>`) + explicit
 * `kind`, resolving any bare id against the button's kind — otherwise the show
 * inspector couldn't match a step to its catalog action and would show no
 * options. The button face + connection carry over so the clip looks and fires
 * like the button. Returns an array (length 1) to fit the paste call site.
 */
export function bindingToClips(binding: DeckBinding, atMs: number): TimelineClip[] {
  const bindingKind = binding.preset.kind;
  const steps: DeckStep[] = binding.preset.steps.map((step) => {
    const kind = step.kind ?? (hasPrefix(step.actionId) ? prefixOf(step.actionId) : bindingKind);
    const id = bareId(step.actionId);
    return { ...step, actionId: `${kind}:${id}`, kind };
  });
  if (steps.length === 0) return [];
  return [
    {
      id: genId("clip"),
      offsetMs: Math.max(0, Math.round(atMs)),
      label: binding.preset.label,
      color: binding.preset.bgcolor,
      connectionId: binding.connectionId,
      steps,
    },
  ];
}

/**
 * Timeline clip → deck button. Carries the clip's whole action list (a
 * multi-action clip → multi-action button). The face matches what the deck
 * gives natively: the catalog `face` (label + category colours) is used
 * unless the clip carries an explicit override.
 */
export function clipToBinding(clip: TimelineClip, face?: ActionFace): DeckBinding {
  const first = clip.steps[0];
  const kind = first ? stepKind(first) : "";
  const id = first ? bareId(first.actionId) : "";
  return {
    connectionId: clip.connectionId ?? first?.connectionId,
    preset: {
      globalId: `${kind}:${id}`,
      kind,
      id,
      label: clip.label?.trim() || face?.label || id,
      bgcolor: clip.color || face?.bgcolor,
      fgcolor: face?.fgcolor,
      steps: clip.steps.map((s) => ({ ...s })),
    },
  };
}
