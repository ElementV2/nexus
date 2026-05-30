import { fileMtimeMs, readJson, writeJson } from "./index";

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
   *  the HID serial — pairing to physical devices lives on
   *  `deviceSerials` so layouts survive USB path changes (re-plug,
   *  different port, OS upgrade). */
  id: string;
  model: DeckModel;
  label: string;
  /** HID serial numbers this layout is paired with. ONE layout can drive
   *  MANY decks at once — local or across satellites (e.g. the same page
   *  loaded onto 15 satellite decks). A press from any of these serials
   *  consults this layout's bindings, and feedback renders to all of
   *  them. A given serial belongs to at most one layout (enforced by
   *  `applyLayoutUpsert`). Empty = design-only, ignored by hardware. */
  deviceSerials: string[];
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
      deviceSerials: [],
      bindings: {},
    },
  ],
};

/**
 * Normalise a persisted/posted layout: coerce pairing into the
 * `deviceSerials: string[]` shape. Migrates the legacy single
 * `deviceSerial` field transparently and drops empties/dupes, so old
 * stores and older clients keep working.
 */
export function normalizeLayout(raw: DeckLayout): DeckLayout {
  const legacy = (raw as { deviceSerial?: unknown }).deviceSerial;
  const fromArray = Array.isArray(raw.deviceSerials) ? raw.deviceSerials : [];
  const all = [
    ...fromArray,
    ...(typeof legacy === "string" ? [legacy] : []),
  ];
  const deviceSerials = [
    ...new Set(
      all.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    ),
  ];
  // Strip the legacy field if present so it never lingers in the store.
  const { ...rest } = raw as DeckLayout & { deviceSerial?: unknown };
  delete (rest as { deviceSerial?: unknown }).deviceSerial;
  return { ...rest, deviceSerials };
}

// mtime-gated cache: the feedback coordinator reads the store on every
// variable burst (≈every vMix poll tick) and the press dispatcher on every
// press. Without this, each call was a synchronous readFileSync + JSON.parse
// + normalize on the event loop — directly competing with HID writes and the
// satellite SSE on the broadcast tally path. A write bumps the file mtime so
// the cache self-invalidates and external launcher edits are still picked up.
let storeCache: { mtime: number | null; value: StreamdeckStore } | null = null;

export function getStreamdeckStore(): StreamdeckStore {
  const mtime = fileMtimeMs(FILE);
  if (storeCache && storeCache.mtime === mtime) {
    return structuredClone(storeCache.value);
  }
  const raw = readJson<Partial<StreamdeckStore>>(FILE, {});
  const value: StreamdeckStore =
    !raw.layouts || !Array.isArray(raw.layouts) || raw.layouts.length === 0
      ? DEFAULT_STORE
      : { layouts: (raw.layouts as DeckLayout[]).map(normalizeLayout) };
  storeCache = { mtime, value };
  return structuredClone(value);
}

export function setStreamdeckStore(next: StreamdeckStore): StreamdeckStore {
  writeJson(FILE, next);
  // Prime the cache with the just-written value + its fresh mtime so the
  // immediate read-back (coordinator refresh after a layout save) hits cache.
  storeCache = { mtime: fileMtimeMs(FILE), value: next };
  return next;
}

export function getLayout(id: string): DeckLayout | undefined {
  return getStreamdeckStore().layouts.find((l) => l.id === id);
}

/**
 * Pure upsert enforcing the **one-serial-one-layout** invariant: a layout
 * may drive MANY decks (`deviceSerials`), but each physical deck (serial)
 * belongs to at most ONE layout. When the upserted layout claims serials,
 * those serials are removed from every OTHER layout.
 *
 * Without this, loading page B onto a deck already showing page A leaves
 * BOTH pages claiming that serial. The press dispatcher resolves a press
 * via the FIRST layout matching the serial (stale page A), so the deck
 * shows B's keys but fires A's shortcuts. Keeping serials unique at write
 * time fixes the press dispatcher and feedback coordinator alike.
 */
export function applyLayoutUpsert(
  layouts: DeckLayout[],
  layout: DeckLayout
): DeckLayout[] {
  const norm = normalizeLayout(layout);
  const idx = layouts.findIndex((l) => l.id === norm.id);
  let next =
    idx >= 0
      ? layouts.map((l, i) => (i === idx ? norm : l))
      : [...layouts, norm];
  const claimed = new Set(norm.deviceSerials);
  if (claimed.size > 0) {
    next = next.map((l) =>
      l.id === norm.id
        ? l
        : l.deviceSerials.some((s) => claimed.has(s))
          ? { ...l, deviceSerials: l.deviceSerials.filter((s) => !claimed.has(s)) }
          : l
    );
  }
  return next;
}

export function upsertLayout(layout: DeckLayout): StreamdeckStore {
  const cur = getStreamdeckStore();
  return setStreamdeckStore({
    layouts: applyLayoutUpsert(cur.layouts, layout),
  });
}

export function removeLayout(id: string): StreamdeckStore {
  const cur = getStreamdeckStore();
  return setStreamdeckStore({
    layouts: cur.layouts.filter((l) => l.id !== id),
  });
}
