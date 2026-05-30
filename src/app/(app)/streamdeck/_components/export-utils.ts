import type { DeckLayout } from "@/lib/db/streamdeck";
import type { ConnectionLite, DeckExportConnRef } from "./types";

/** The kind an action dispatches to: its own > the global-id prefix >
 *  the binding's preset kind. */
export function stepKind(
  step: { actionId: string; kind?: string },
  presetKind: string
): string {
  if (step.kind) return step.kind;
  if (step.actionId.includes(":")) {
    return step.actionId.slice(0, step.actionId.indexOf(":"));
  }
  return presetKind;
}

/** Mapping key for "all unpinned actions of a kind" (the default
 *  bucket). Keeps the import remap able to reassign actions that run on
 *  a kind's default connection — they carry no explicit id otherwise. */
export function defaultBucketKey(kind: string): string {
  return `default:${kind}`;
}
export function isDefaultBucket(key: string): boolean {
  return key.startsWith("default:");
}

/**
 * Every connection target a page references, for the import remap UI:
 *   • one entry per explicitly-pinned connection id (resolved to its
 *     current kind/label), AND
 *   • one "<kind> · default" bucket per kind that has any UNPINNED
 *     action — so actions running on a kind's default still show up and
 *     can be reassigned to a specific connection on import.
 *
 * This is why a page whose vMix actions used the default + one pinned
 * Ableton action now lists BOTH vMix and Ableton, not just Ableton.
 */
export function collectConnRefs(
  layouts: DeckLayout[],
  connections: ConnectionLite[]
): DeckExportConnRef[] {
  const pinned = new Set<string>();
  const kindsWithDefault = new Set<string>();
  for (const l of layouts) {
    for (const b of Object.values(l.bindings)) {
      if (b.connectionId) pinned.add(b.connectionId);
      for (const s of b.preset.steps) {
        const k = stepKind(s, b.preset.kind);
        if (s.connectionId) pinned.add(s.connectionId);
        else kindsWithDefault.add(k);
      }
    }
  }
  const refs: DeckExportConnRef[] = [];
  for (const id of pinned) {
    const c = connections.find((x) => x.id === id);
    refs.push({ id, kind: c?.kind ?? "?", label: c?.label ?? id });
  }
  for (const kind of kindsWithDefault) {
    refs.push({
      id: defaultBucketKey(kind),
      kind,
      label: `${kind} · default`,
    });
  }
  return refs;
}

/** Rewrite a layout's connection ids through a remap, assign a fresh
 *  layout id, drop the per-machine pairing. `mapStep(oldId, kind)`
 *  returns the new id (or undefined to fall back to the kind default). */
export function remapLayout(
  layout: DeckLayout,
  newId: string,
  mapStep: (oldId: string | undefined, kind: string) => string | undefined
): DeckLayout {
  const bindings: DeckLayout["bindings"] = {};
  for (const [k, b] of Object.entries(layout.bindings)) {
    bindings[Number(k)] = {
      ...b,
      connectionId: mapStep(b.connectionId, b.preset.kind),
      preset: {
        ...b.preset,
        steps: b.preset.steps.map((s) => ({
          ...s,
          connectionId: mapStep(s.connectionId, stepKind(s, b.preset.kind)),
        })),
      },
    };
  }
  return {
    ...layout,
    id: newId,
    deviceSerial: undefined,
    bindings,
  };
}
