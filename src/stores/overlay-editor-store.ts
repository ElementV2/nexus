import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  OverlayConfig,
  OverlayElement,
} from "@/lib/web-assets/types";
import {
  ASSET_WIDTH,
  ASSET_HEIGHT,
  MAX_UNDO_HISTORY,
  SNAP_THRESHOLD,
} from "@/lib/vmix/constants";
import { createId } from "@/lib/utils/id";

// ── Snap types ──
export interface SnapLine {
  axis: "x" | "y";
  position: number;
}

export interface DistanceIndicator {
  axis: "x" | "y";
  from: number;
  to: number;
  offset: number; // perpendicular position for drawing
  value: number;
}

// ── Tool type ──
export type ActiveTool = "select" | "hole" | "text" | "image";

// ── Store interface ──
interface OverlayEditorStore {
  // Data
  overlays: OverlayConfig[];
  activeOverlayId: string | null;
  selectedElementIds: string[];

  // Tools
  activeTool: ActiveTool;

  // Snap
  snapEnabled: boolean;
  snapThreshold: number;
  activeSnapLines: SnapLine[];
  activeDistances: DistanceIndicator[];

  // Undo
  undoStack: OverlayConfig[][];
  redoStack: OverlayConfig[][];

  // ── Overlay CRUD ──
  addOverlay: (overlay?: Partial<OverlayConfig>) => void;
  removeOverlay: (id: string) => void;
  setActiveOverlay: (id: string) => void;
  updateOverlay: (id: string, updates: Partial<OverlayConfig>) => void;

  // ── Element CRUD ──
  addElement: (element: OverlayElement) => void;
  updateElement: (id: string, updates: Partial<OverlayElement>) => void;
  updateElements: (updates: { id: string; changes: Partial<OverlayElement> }[]) => void;
  removeElements: (ids: string[]) => void;
  duplicateElements: (ids: string[]) => void;

  // ── Selection ──
  selectElement: (id: string, multi?: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setSelectedElementIds: (ids: string[]) => void;

  // ── Tool ──
  setActiveTool: (tool: ActiveTool) => void;

  // ── Z-order ──
  bringForward: (ids: string[]) => void;
  sendBackward: (ids: string[]) => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;

  // ── Alignment ──
  alignElements: (alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;

  // ── Snap ──
  setSnapEnabled: (enabled: boolean) => void;
  setActiveSnapLines: (lines: SnapLine[]) => void;
  setActiveDistances: (distances: DistanceIndicator[]) => void;
  clearSnapGuides: () => void;

  // ── Clipboard ──
  clipboard: OverlayElement[];
  copy: () => void;
  cut: () => void;
  paste: () => void;

  // ── Undo/Redo ──
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;

  // ── Persistence ──
  loadFromStorage: () => void;
  _saveToStorage: () => void;
}

function defaultOverlay(name?: string): OverlayConfig {
  return {
    id: createId(),
    name: name || "Overlay 1",
    backgroundType: "color",
    backgroundColor: "#083a8b",
    backgroundImageUrl: null,
    textureUrl: null,
    blendMode: "normal",
    textureOpacity: 0.8,
    elements: [],
  };
}

const STORAGE_KEY = "overlay-editor-v2";

export const useOverlayEditorStore = create<OverlayEditorStore>()(
  subscribeWithSelector((set, get) => {
    const withUndo = (fn: (state: OverlayEditorStore) => Partial<OverlayEditorStore>) => {
      const state = get();
      const undoStack = [...state.undoStack, state.overlays].slice(-MAX_UNDO_HISTORY);
      const result = fn(state);
      return { ...result, undoStack, redoStack: [] as OverlayConfig[][] };
    };

    const updateActiveOverlayElements = (
      state: OverlayEditorStore,
      updater: (elements: OverlayElement[]) => OverlayElement[]
    ): Partial<OverlayEditorStore> => {
      const overlay = state.overlays.find((o) => o.id === state.activeOverlayId);
      if (!overlay) return {};
      return {
        overlays: state.overlays.map((o) =>
          o.id === state.activeOverlayId
            ? { ...o, elements: updater(o.elements) }
            : o
        ),
      };
    };

    return {
      overlays: [],
      activeOverlayId: null,
      selectedElementIds: [],
      activeTool: "select",
      snapEnabled: true,
      snapThreshold: SNAP_THRESHOLD,
      activeSnapLines: [],
      activeDistances: [],
      undoStack: [],
      redoStack: [],
      clipboard: [],

      // ── Overlay CRUD ──
      addOverlay: (partial) => {
        const overlay = {
          ...defaultOverlay(),
          ...partial,
          id: createId(),
        };
        set((s) => ({
          overlays: [...s.overlays, overlay],
          activeOverlayId: overlay.id,
          selectedElementIds: [],
        }));
      },

      removeOverlay: (id) => {
        // Async DB delete (fire and forget)
        fetch(`/api/overlays/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
        set((s) => {
          const filtered = s.overlays.filter((o) => o.id !== id);
          return {
            overlays: filtered,
            activeOverlayId:
              s.activeOverlayId === id
                ? filtered[0]?.id || null
                : s.activeOverlayId,
            selectedElementIds:
              s.activeOverlayId === id ? [] : s.selectedElementIds,
          };
        });
      },

      setActiveOverlay: (id) =>
        set({ activeOverlayId: id, selectedElementIds: [] }),

      updateOverlay: (id, updates) =>
        set((s) => ({
          overlays: s.overlays.map((o) =>
            o.id === id ? { ...o, ...updates } : o
          ),
        })),

      // ── Element CRUD ──
      addElement: (element) =>
        set(() =>
          withUndo((state) => {
            const overlay = state.overlays.find(
              (o) => o.id === state.activeOverlayId
            );
            if (!overlay) return {};
            const maxZ = overlay.elements.reduce(
              (max, e) => Math.max(max, e.zIndex),
              -1
            );
            const newEl = { ...element, zIndex: maxZ + 1 };
            return {
              ...updateActiveOverlayElements(state, (els) => [...els, newEl]),
              selectedElementIds: [newEl.id],
              activeTool: "select",
            };
          })
        ),

      updateElement: (id, updates) =>
        set((s) => updateActiveOverlayElements(s, (els) =>
          els.map((e) => (e.id === id ? { ...e, ...updates } as OverlayElement : e))
        )),

      updateElements: (updates) =>
        set((s) =>
          updateActiveOverlayElements(s, (els) =>
            els.map((e) => {
              const u = updates.find((u) => u.id === e.id);
              return u ? { ...e, ...u.changes } as OverlayElement : e;
            })
          )
        ),

      removeElements: (ids) =>
        set(() =>
          withUndo((state) => ({
            ...updateActiveOverlayElements(state, (els) =>
              els.filter((e) => !ids.includes(e.id))
            ),
            selectedElementIds: state.selectedElementIds.filter(
              (id) => !ids.includes(id)
            ),
          }))
        ),

      duplicateElements: (ids) =>
        set(() =>
          withUndo((state) => {
            const overlay = state.overlays.find(
              (o) => o.id === state.activeOverlayId
            );
            if (!overlay) return {};
            const toDuplicate = overlay.elements.filter((e) =>
              ids.includes(e.id)
            );
            const maxZ = overlay.elements.reduce(
              (max, e) => Math.max(max, e.zIndex),
              -1
            );
            const newEls = toDuplicate.map((e, i) => ({
              ...e,
              id: createId(),
              x: e.x + 20,
              y: e.y + 20,
              zIndex: maxZ + 1 + i,
              name: `${e.name} copy`,
            }));
            return {
              ...updateActiveOverlayElements(state, (els) => [
                ...els,
                ...newEls,
              ]),
              selectedElementIds: newEls.map((e) => e.id),
            };
          })
        ),

      // ── Selection ──
      selectElement: (id, multi) =>
        set((s) => ({
          selectedElementIds: multi
            ? s.selectedElementIds.includes(id)
              ? s.selectedElementIds.filter((i) => i !== id)
              : [...s.selectedElementIds, id]
            : [id],
        })),

      selectAll: () =>
        set((s) => {
          const overlay = s.overlays.find(
            (o) => o.id === s.activeOverlayId
          );
          if (!overlay) return {};
          return {
            selectedElementIds: overlay.elements
              .filter((e) => !e.locked)
              .map((e) => e.id),
          };
        }),

      deselectAll: () => set({ selectedElementIds: [] }),

      setSelectedElementIds: (ids) => set({ selectedElementIds: ids }),

      // ── Tool ──
      setActiveTool: (tool) => set({ activeTool: tool }),

      // ── Z-order ──
      bringForward: (ids) =>
        set(() =>
          withUndo((state) =>
            updateActiveOverlayElements(state, (els) => {
              const sorted = [...els].sort((a, b) => a.zIndex - b.zIndex);
              for (let i = sorted.length - 2; i >= 0; i--) {
                if (ids.includes(sorted[i].id) && !ids.includes(sorted[i + 1].id)) {
                  [sorted[i], sorted[i + 1]] = [sorted[i + 1], sorted[i]];
                }
              }
              return sorted.map((e, i) => ({ ...e, zIndex: i }));
            })
          )
        ),

      sendBackward: (ids) =>
        set(() =>
          withUndo((state) =>
            updateActiveOverlayElements(state, (els) => {
              const sorted = [...els].sort((a, b) => a.zIndex - b.zIndex);
              for (let i = 1; i < sorted.length; i++) {
                if (ids.includes(sorted[i].id) && !ids.includes(sorted[i - 1].id)) {
                  [sorted[i], sorted[i - 1]] = [sorted[i - 1], sorted[i]];
                }
              }
              return sorted.map((e, i) => ({ ...e, zIndex: i }));
            })
          )
        ),

      bringToFront: (ids) =>
        set(() =>
          withUndo((state) =>
            updateActiveOverlayElements(state, (els) => {
              const others = els.filter((e) => !ids.includes(e.id));
              const selected = els.filter((e) => ids.includes(e.id));
              return [...others, ...selected].map((e, i) => ({
                ...e,
                zIndex: i,
              }));
            })
          )
        ),

      sendToBack: (ids) =>
        set(() =>
          withUndo((state) =>
            updateActiveOverlayElements(state, (els) => {
              const others = els.filter((e) => !ids.includes(e.id));
              const selected = els.filter((e) => ids.includes(e.id));
              return [...selected, ...others].map((e, i) => ({
                ...e,
                zIndex: i,
              }));
            })
          )
        ),

      // ── Alignment ──
      alignElements: (alignment) =>
        set(() =>
          withUndo((state) => {
            const overlay = state.overlays.find(
              (o) => o.id === state.activeOverlayId
            );
            if (!overlay) return {};
            const selected = overlay.elements.filter((e) =>
              state.selectedElementIds.includes(e.id)
            );
            if (selected.length === 0) return {};

            // If 1 element, align to canvas. If multiple, align to bounding box.
            let refLeft: number, refRight: number, refTop: number, refBottom: number;
            if (selected.length === 1) {
              refLeft = 0;
              refRight = ASSET_WIDTH;
              refTop = 0;
              refBottom = ASSET_HEIGHT;
            } else {
              refLeft = Math.min(...selected.map((e) => e.x));
              refRight = Math.max(...selected.map((e) => e.x + e.width));
              refTop = Math.min(...selected.map((e) => e.y));
              refBottom = Math.max(...selected.map((e) => e.y + e.height));
            }

            const updates: Record<string, Partial<OverlayElement>> = {};
            for (const el of selected) {
              switch (alignment) {
                case "left":
                  updates[el.id] = { x: refLeft };
                  break;
                case "center":
                  updates[el.id] = {
                    x: refLeft + (refRight - refLeft) / 2 - el.width / 2,
                  };
                  break;
                case "right":
                  updates[el.id] = { x: refRight - el.width };
                  break;
                case "top":
                  updates[el.id] = { y: refTop };
                  break;
                case "middle":
                  updates[el.id] = {
                    y: refTop + (refBottom - refTop) / 2 - el.height / 2,
                  };
                  break;
                case "bottom":
                  updates[el.id] = { y: refBottom - el.height };
                  break;
              }
            }

            return updateActiveOverlayElements(state, (els) =>
              els.map((e) =>
                updates[e.id] ? { ...e, ...updates[e.id] } as OverlayElement : e
              )
            );
          })
        ),

      // ── Snap ──
      setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
      setActiveSnapLines: (lines) => set({ activeSnapLines: lines }),
      setActiveDistances: (distances) => set({ activeDistances: distances }),
      clearSnapGuides: () =>
        set({ activeSnapLines: [], activeDistances: [] }),

      // ── Clipboard ──
      copy: () => {
        const s = get();
        const overlay = selectActiveOverlay(s);
        if (!overlay) return;
        const selected = overlay.elements.filter((e) => s.selectedElementIds.includes(e.id));
        set({ clipboard: selected });
      },

      cut: () => {
        const s = get();
        const overlay = selectActiveOverlay(s);
        if (!overlay) return;
        const selected = overlay.elements.filter((e) => s.selectedElementIds.includes(e.id));
        set({ clipboard: selected });
        s.removeElements(selected.map((e) => e.id));
      },

      paste: () => {
        const s = get();
        const { clipboard } = s;
        if (clipboard.length === 0) return;
        const overlay = selectActiveOverlay(s);
        if (!overlay) return;
        const maxZ = overlay.elements.reduce(
          (max, e) => Math.max(max, e.zIndex),
          -1
        );
        const newEls = clipboard.map((e, i) => ({
          ...e,
          id: createId(),
          x: e.x + 20,
          y: e.y + 20,
          zIndex: maxZ + 1 + i,
        }));

        set((s) => {
          const undoStack = [...s.undoStack, s.overlays].slice(-MAX_UNDO_HISTORY);
          return {
            ...updateActiveOverlayElements(s, (els) => [...els, ...newEls]),
            selectedElementIds: newEls.map((e) => e.id),
            undoStack,
            redoStack: [],
          };
        });
      },

      // ── Undo/Redo ──
      pushUndo: () =>
        set((s) => ({
          undoStack: [...s.undoStack, s.overlays].slice(-MAX_UNDO_HISTORY),
          redoStack: [],
        })),

      undo: () =>
        set((s) => {
          if (s.undoStack.length === 0) return {};
          const prev = s.undoStack[s.undoStack.length - 1];
          return {
            overlays: prev,
            undoStack: s.undoStack.slice(0, -1),
            redoStack: [...s.redoStack, s.overlays],
            selectedElementIds: [],
          };
        }),

      redo: () =>
        set((s) => {
          if (s.redoStack.length === 0) return {};
          const next = s.redoStack[s.redoStack.length - 1];
          return {
            overlays: next,
            redoStack: s.redoStack.slice(0, -1),
            undoStack: [...s.undoStack, s.overlays],
            selectedElementIds: [],
          };
        }),

      // ── Persistence ──
      loadFromStorage: async () => {
        // Try local DB first
        try {
          const res = await fetch("/api/overlays", { cache: "no-store" });
          if (res.ok) {
            const { overlays: remote } = (await res.json()) as {
              overlays: OverlayConfig[];
            };
            if (remote && remote.length > 0) {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
              set({ overlays: remote, activeOverlayId: remote[0].id });
              return;
            }
          }
        } catch {
          // DB unavailable, fall through to localStorage
        }

        // Fallback: localStorage
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const data = JSON.parse(raw) as OverlayConfig[];
            if (data.length > 0) {
              set({ overlays: data, activeOverlayId: data[0].id });
              return;
            }
          }
        } catch {
          // ignore
        }

        // Nothing found — create default
        const def = defaultOverlay();
        set({ overlays: [def], activeOverlayId: def.id });
      },

      _saveToStorage: () => {
        // Debounce BOTH the localStorage write and the DB sync. During
        // a drag we fire one `overlays` change per pointer-move event;
        // serialising the whole overlay graph to JSON 60× a second
        // and pushing it to localStorage (synchronous API) can stall
        // the main thread on heavy overlays.
        _debouncedLocalStorageSave();
        _debouncedDbSync();
      },
    };
  })
);

// ── Standalone selectors (stable references, safe for React render) ──

/** Select the active overlay — returns the same reference if overlays/activeOverlayId haven't changed */
export function selectActiveOverlay(s: OverlayEditorStore): OverlayConfig | null {
  return s.overlays.find((o) => o.id === s.activeOverlayId) || null;
}

/** Imperative helper: get the active overlay from current state (for event handlers, not render) */
export function getActiveOverlay(): OverlayConfig | null {
  const s = useOverlayEditorStore.getState();
  return selectActiveOverlay(s);
}

// ── Debounced persistence (both layers) ──
// We always read overlays from `getState()` at flush time so a fast
// burst of edits collapses to a single write of the *latest* state,
// not the state at the moment the debounce was scheduled.
let _localTimer: ReturnType<typeof setTimeout> | null = null;
let _syncTimer: ReturnType<typeof setTimeout> | null = null;

function _debouncedLocalStorageSave() {
  if (_localTimer) clearTimeout(_localTimer);
  _localTimer = setTimeout(() => {
    try {
      const { overlays } = useOverlayEditorStore.getState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overlays));
    } catch {
      // localStorage may be full or unavailable; not fatal — the DB
      // sync below is still authoritative.
    }
  }, 250);
}

function _debouncedDbSync() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    const { overlays } = useOverlayEditorStore.getState();
    fetch("/api/overlays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overlays }),
    }).catch(() => {
      // silently fail — localStorage is the safety net
    });
  }, 1000);
}

// Auto-save on overlay changes
if (typeof window !== "undefined") {
  useOverlayEditorStore.subscribe(
    (s) => s.overlays,
    () => {
      useOverlayEditorStore.getState()._saveToStorage();
    }
  );
}
