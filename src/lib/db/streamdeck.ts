import { readJson, writeJson } from "./index";

/**
 * Persisted Stream Deck button layouts. Stored in a dedicated file so
 * the main preferences blob stays small — a single deck with 32
 * bound buttons is already several KB of JSON with text + colors +
 * options, and an operator may keep several decks.
 *
 * The hardware-writing layer hasn't been wired yet (HID requires
 * Electron main + native deps). The Phase-0 mockup just persists
 * bindings so the editor is fully usable for layout design; future
 * work hooks each press/render to the actual device.
 */

const FILE = "streamdeck.json";

export type DeckModel = "xl" | "mk2" | "mini" | "plus" | "studio" | "original";

export interface DeckGeometry {
  rows: number;
  cols: number;
  label: string;
}

/**
 * Geometry per hardware model. Matches Elgato's published key counts.
 * "Plus" deck has 2x4 = 8 keys plus dials / touch strip we defer.
 * "Studio" has 6 keys + 4 LCD displays; we represent it as a single
 * 1×6 row for now (the dials live elsewhere in their own row).
 */
export const DECK_GEOMETRIES: Record<DeckModel, DeckGeometry> = {
  xl: { rows: 4, cols: 8, label: "Stream Deck XL" },
  mk2: { rows: 3, cols: 5, label: "Stream Deck MK.2" },
  original: { rows: 3, cols: 5, label: "Stream Deck (original)" },
  plus: { rows: 2, cols: 4, label: "Stream Deck +" },
  mini: { rows: 2, cols: 3, label: "Stream Deck Mini" },
  studio: { rows: 1, cols: 6, label: "Stream Deck Studio" },
};

/**
 * One action fired when the key is pressed. A button holds an ordered
 * list of these — so a single key can trigger several things, and each
 * entry can target a different device kind and/or a specific connection
 * instance (which of several vMix machines).
 *
 * `connectionId`/`kind` are optional for backward compatibility: a
 * binding saved before multi-instance support simply omits them and
 * resolves to the kind's default connection at fire time.
 */
export interface DeckStep {
  /** Bare action id ("cut") or namespaced global id ("obs:set-scene"). */
  actionId: string;
  options?: Record<string, unknown>;
  /** Pin this step to a specific connection instance. Undefined =
   *  fall back to the binding-level pin, then the kind default. */
  connectionId?: string;
  /** Override the device kind for this step (a button mixing vMix +
   *  OBS actions). Undefined = the binding's preset kind. */
  kind?: string;
}

export interface DeckBinding {
  /** The dropped preset payload — text + colors + steps. Stored
   *  verbatim so a future preset rename / kind reorganisation doesn't
   *  invalidate every existing binding. The `steps` list is the
   *  button's action list: drop more presets onto an occupied key and
   *  their steps append here. */
  preset: {
    globalId: string;
    kind: string;
    id: string;
    label: string;
    text?: string;
    bgcolor?: string;
    fgcolor?: string;
    steps: DeckStep[];
  };
  /** Button-level default connection — applies to every step that
   *  doesn't pin its own. Undefined = the kind's default connection.
   *  This is how the operator says "this key controls vMix #2". */
  connectionId?: string;
}

export interface DeckLayout {
  /** Stable id. Free-form ("default", "deck-…"). Doesn't have to be
   *  the HID serial — pairing to a physical device lives on
   *  `deviceSerial` so layouts survive USB path changes (re-plug,
   *  different port, OS upgrade). */
  id: string;
  model: DeckModel;
  label: string;
  /** HID serial number this layout is paired with. When a physical
   *  device with the matching serial fires a key, this layout's
   *  bindings are consulted. Unpaired layouts (`undefined`) are
   *  design-only — visible in the editor, ignored by hardware. */
  deviceSerial?: string;
  /** Sparse: only filled keys appear. Key index is row * cols + col. */
  bindings: Record<number, DeckBinding>;
}

export interface StreamdeckStore {
  layouts: DeckLayout[];
}

const DEFAULT_STORE: StreamdeckStore = {
  layouts: [
    {
      id: "default",
      model: "xl",
      label: "My Stream Deck",
      bindings: {},
    },
  ],
};

export function getStreamdeckStore(): StreamdeckStore {
  const raw = readJson<Partial<StreamdeckStore>>(FILE, {});
  if (!raw.layouts || !Array.isArray(raw.layouts) || raw.layouts.length === 0) {
    return DEFAULT_STORE;
  }
  return { layouts: raw.layouts as DeckLayout[] };
}

export function setStreamdeckStore(next: StreamdeckStore): StreamdeckStore {
  writeJson(FILE, next);
  return next;
}

export function getLayout(id: string): DeckLayout | undefined {
  return getStreamdeckStore().layouts.find((l) => l.id === id);
}

export function upsertLayout(layout: DeckLayout): StreamdeckStore {
  const cur = getStreamdeckStore();
  const idx = cur.layouts.findIndex((l) => l.id === layout.id);
  const next: StreamdeckStore = { ...cur };
  if (idx >= 0) {
    next.layouts = [...cur.layouts];
    next.layouts[idx] = layout;
  } else {
    next.layouts = [...cur.layouts, layout];
  }
  return setStreamdeckStore(next);
}

export function removeLayout(id: string): StreamdeckStore {
  const cur = getStreamdeckStore();
  return setStreamdeckStore({
    layouts: cur.layouts.filter((l) => l.id !== id),
  });
}
