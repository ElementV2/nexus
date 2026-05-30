"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar, Eyebrow, useConfirm } from "@/components/sw";
import { PresetBrowserPanel } from "@/components/presets/preset-browser";
import { useVariables } from "@/hooks/use-variables";
import { useConnections } from "@/hooks/use-connections";
import { evaluateFeedback } from "@/lib/streamdeck/feedback";
import type {
  DeckLayout,
  DeckModel,
  DeckBinding,
} from "@/lib/db/streamdeck";
import {
  FIRE_FEEDBACK_MS,
  FIRE_ERROR_MS,
  type DevicesResponse,
  type LayoutsResponse,
  type PresetPayload,
  type FireState,
  type DeckExportFile,
} from "./_components/types";
import {
  collectConnRefs,
  defaultBucketKey,
  remapLayout,
} from "./_components/export-utils";
import { DeckKey } from "./_components/DeckKey";
import { PagesRail } from "./_components/PagesRail";
import { ImportModal, LoadToDeckModal } from "./_components/modals";
import { KeyInspector } from "./_components/KeyInspector";
import { EditorToolbar } from "./_components/EditorToolbar";

export default function StreamdeckPage() {
  const [data, setData] = useState<LayoutsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string>("default");
  const [draft, setDraft] = useState<DeckLayout | null>(null);
  // Always-current draft, so the deck-key event handlers (drop / clear /
  // update) can be STABLE (empty deps) and read the latest draft from
  // here. Stable handlers are what let `DeckKey` be `React.memo`'d
  // safely — a memoized cell that keeps an old handler closure would
  // otherwise operate on a stale `draft` and clobber other keys' edits.
  const draftRef = useRef<DeckLayout | null>(draft);
  draftRef.current = draft;
  const [dirty, setDirty] = useState(false);
  const [fire, setFire] = useState<FireState>({ kind: "idle" });
  const [hoverKey, setHoverKey] = useState<number | null>(null);
  // Editor selection — single-click on a bound key selects it and
  // pops the right sidebar to its inspector tab. Hardware press
  // still fires (server-side SSE).
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"inspector" | "browser">(
    "browser"
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hardware state — driver status + detected devices.
  // Note: there's no longer an "active device" picker — pairing
  // lives on the layout itself (`draft.deviceSerial`), so the device
  // a render targets is implicit from the layout being edited.
  const [hw, setHw] = useState<DevicesResponse | null>(null);

  // Live variables from the bus + the connections registry so the
  // mockup can compute the same feedback overrides the hardware
  // shows. Both are SSE-fed under the hood — no polling cost.
  const vars = useVariables();
  const { data: connectionsData } = useConnections();
  const connectionIdsByKind = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of connectionsData?.connections ?? []) {
      if (!c.enabled) continue;
      if (!out[c.kind]) out[c.kind] = [];
      out[c.kind].push(c.id);
    }
    return out;
  }, [connectionsData]);
  // Default connection per kind + the flat connection list — the
  // inspector's per-action target picker and the mockup feedback both
  // need these so a key shows + controls the chosen instance.
  const defaultsByKind = useMemo(
    () => connectionsData?.defaults ?? {},
    [connectionsData]
  );
  const connections = useMemo(
    () => connectionsData?.connections ?? [],
    [connectionsData]
  );
  // Browser sidebar visibility — collapsed users get the full deck
  // width back. Persisted in localStorage so the choice carries
  // between sessions; SSR-safe by reading lazily in an effect.
  const [browserOpen, setBrowserOpen] = useState(true);
  useEffect(() => {
    const stored = window.localStorage.getItem("streamdeck:browser-open");
    if (stored === "0") setBrowserOpen(false);
  }, []);
  const toggleBrowser = useCallback(() => {
    setBrowserOpen((cur) => {
      const next = !cur;
      try {
        window.localStorage.setItem("streamdeck:browser-open", next ? "1" : "0");
      } catch {
        /* private-mode / quota — non-fatal */
      }
      return next;
    });
  }, []);
  /** Pending hardware pushes keyed by key index. The value carries
   *  the freshest binding (or `null` for cleared) so the flush sees
   *  the latest state regardless of React batching — `useState`
   *  setters don't update closures synchronously, so capturing the
   *  binding at queue time is the only race-free way. */
  const pendingKeys = useRef<Map<number, DeckBinding | null>>(new Map());

  // Initial load
  useEffect(() => {
    let cancelled = false;
    fetch("/api/streamdeck/layouts", { cache: "no-store" })
      .then((r) => r.json() as Promise<LayoutsResponse>)
      .then((json) => {
        if (cancelled) return;
        setData(json);
        const first =
          json.layouts.find((l) => l.id === selectedId) ?? json.layouts[0];
        if (first) {
          setSelectedId(first.id);
          setDraft(first);
        }
      })
      .catch(() => {
        /* leave null → loading UI */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the most recently-applied layout id so we can tell apart:
  //   • A real user-initiated layout switch (selectedId changes) →
  //     sync the draft to the new layout, clear selection.
  //   • A save echo (data refreshes with the same selectedId) → leave
  //     the draft alone so the operator's in-flight edits don't get
  //     clobbered and the inspector doesn't close.
  // Without this guard, every debounced save → API echo → data
  // update tripped the effect and reset selectedKey to null,
  // dropping the operator out of the inspector mid-edit.
  const lastSelectedId = useRef(selectedId);
  useEffect(() => {
    if (!data) return;
    if (selectedId === lastSelectedId.current) return;
    lastSelectedId.current = selectedId;
    const l = data.layouts.find((x) => x.id === selectedId);
    if (l) {
      setDraft(l);
      setDirty(false);
      // Drop the selection on layout switch — the selected key index
      // doesn't carry meaning across layouts.
      setSelectedKey(null);
    }
  }, [selectedId, data]);

  // When a key is selected, auto-switch the sidebar to the inspector
  // tab so the editor jumps into context. Deselecting doesn't force
  // a switch back — the operator might want to keep editing the
  // selection while browsing for the next preset to drag.
  useEffect(() => {
    if (selectedKey !== null) setSidebarTab("inspector");
  }, [selectedKey]);

  // Hardware: fetch driver status + device list once, then refresh on
  // SSE `devices-changed` events. The driver SSE also pushes key
  // events, but those run server-side via `runPreset` — the UI just
  // shows a brief pulse for operator feedback (future polish).
  const refreshHardware = useCallback(async () => {
    try {
      const res = await fetch("/api/streamdeck/devices", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as DevicesResponse;
      setHw(json);
    } catch {
      /* leave hw as-is */
    }
  }, []);

  useEffect(() => {
    void refreshHardware();
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/streamdeck/events");
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as { type: string };
          if (ev.type === "devices-changed") {
            void refreshHardware();
          }
        } catch {
          /* ignore malformed */
        }
      };
      es.onerror = () => {
        // Browser auto-reconnects; nothing to do here.
      };
    } catch {
      /* no SSE — UI will refetch on user action */
    }
    return () => {
      es?.close();
    };
  }, [refreshHardware]);

  // Push a single key to hardware. Sends the captured-at-queue-time
  // binding inside the body so the server doesn't need to read the
  // (possibly stale) persisted store. Eliminates the race between
  // the immediate push and the 400 ms debounced save.
  const flushPendingPushes = useCallback(() => {
    const draft = draftRef.current;
    if (!draft || !draft.deviceSerial) {
      pendingKeys.current.clear();
      return;
    }
    const layoutId = draft.id;
    const pending = Array.from(pendingKeys.current.entries());
    pendingKeys.current.clear();
    for (const [keyIndex, binding] of pending) {
      void fetch("/api/streamdeck/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layoutId,
          keyIndex,
          binding,
        }),
      }).catch(() => {
        /* swallow — surface page status banner if it becomes a pattern */
      });
    }
  }, []);

  // Capture the binding AT QUEUE TIME (closure-fresh) so the flush
  // sees the latest value even if React hasn't committed the
  // re-render yet. Pass `null` to clear.
  const queueKeyPush = useCallback(
    (keyIndex: number, binding: DeckBinding | null | undefined) => {
      pendingKeys.current.set(keyIndex, binding ?? null);
      queueMicrotask(flushPendingPushes);
    },
    [flushPendingPushes]
  );

  // Persist a new pairing on the current layout. Saves immediately
  // (not via the debounced effect) so an explicit user choice
  // doesn't sit pending.
  const setPairedDevice = useCallback(
    async (serial: string | null) => {
      if (!draft) return;
      const next: DeckLayout = {
        ...draft,
        deviceSerial: serial ?? undefined,
      };
      setDraft(next);
      try {
        const res = await fetch("/api/streamdeck/layouts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: next }),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            store: { layouts: DeckLayout[] };
          };
          setData((cur) =>
            cur ? { ...cur, layouts: json.store.layouts } : cur
          );
          // After re-pairing, render the layout to the new device so
          // the operator sees their bindings immediately.
          if (serial) {
            void fetch("/api/streamdeck/push", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ layoutId: next.id }),
            }).catch(() => {});
          }
        }
      } catch {
        /* leave draft locally; manual save still possible */
      }
    },
    [draft]
  );

  // Auto-pair convenience: when exactly one device is connected and
  // the current layout has no pairing AND no other layout claims that
  // device, set it. Saves the new operator from a dropdown trip in
  // the common single-deck case. Skip if user has explicit pairings
  // elsewhere — we don't want to steal a device.
  useEffect(() => {
    if (!hw || !draft || !data) return;
    if (draft.deviceSerial) return;
    if (hw.devices.length !== 1) return;
    const onlyDev = hw.devices[0];
    if (!onlyDev.serialNumber) return;
    const claimed = data.layouts.some(
      (l) => l.deviceSerial === onlyDev.serialNumber
    );
    if (claimed) return;
    void setPairedDevice(onlyDev.serialNumber);
  }, [hw, draft, data, setPairedDevice]);

  // Visible save status for the toolbar chip and for the
  // beforeunload guard. `saving` covers both "pending debounce" and
  // "request in flight"; `error` flips when a save fails so the
  // operator can see something's wrong rather than thinking it
  // landed.
  const saveAttempt = useRef(0);
  // Bumped on every failed save to re-arm the retry. The old code did
  // `setDirty((d) => d)` which is a no-op for React (same value) and so
  // the effect never re-ran — failed saves silently stopped retrying.
  // A real state change in the dep array fixes that.
  const [retryNonce, setRetryNonce] = useState(0);

  // Debounced auto-save with auto-retry. Failures bump `retryNonce`
  // (and `saveAttempt` for backoff), which re-runs this effect and
  // schedules the next attempt — we never silently swallow a failed
  // save; the operator either recovers (server back up) or sees the
  // error chip.
  useEffect(() => {
    if (!draft || !dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Exponential backoff on retry. First attempt fires after 400 ms
    // (debounce window). Retry 1 after 800 ms. Retry 2 after 1600 ms.
    // Capped at 5 s so we keep poking the server back to life
    // without flooding it.
    const delay = Math.min(5000, 400 * Math.pow(2, saveAttempt.current));
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/streamdeck/layouts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: draft }),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            store: { layouts: DeckLayout[] };
          };
          setData((cur) =>
            cur ? { ...cur, layouts: json.store.layouts } : cur
          );
          setDirty(false);
          saveAttempt.current = 0;
        } else {
          saveAttempt.current += 1;
          // Re-run the effect (it stays `dirty`); the higher
          // saveAttempt grows the backoff delay for the next attempt.
          setRetryNonce((n) => n + 1);
        }
      } catch {
        // Network/server error — back off and retry; the TopBar
        // sub-line already signals unsaved/auto-saving state.
        saveAttempt.current += 1;
        setRetryNonce((n) => n + 1);
      }
    }, delay);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, dirty, retryNonce]);

  // beforeunload safety net: if a save is pending when the user
  // closes / refreshes the tab, fire a last-chance request with
  // `keepalive: true` (the only fetch flag that survives the unload
  // transition — regular fetches get cancelled). We can't use
  // `navigator.sendBeacon` here because that's POST-only and our
  // route expects PUT.
  //
  // The browser confirm prompt is the secondary defence: it lets
  // the operator cancel the close if the keepalive request hasn't
  // landed yet, or if their browser doesn't support it (older
  // Safari).
  useEffect(() => {
    if (!dirty || !draft) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      try {
        void fetch("/api/streamdeck/layouts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: draft }),
          keepalive: true,
        });
      } catch {
        /* keepalive bodies are size-capped at 64 KB by spec — our
           layouts are well under that, but guard anyway */
      }
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, draft]);

  const geometry = useMemo(() => {
    if (!data || !draft) return null;
    return data.geometries[draft.model];
  }, [data, draft]);

  const handleDrop = useCallback(
    (targetIndex: number, e: React.DragEvent) => {
      e.preventDefault();
      setHoverKey(null);
      const draft = draftRef.current;
      if (!draft) return;

      // Two drag sources land on a deck cell:
      //
      //  1. From the preset browser (or another deck) — fresh binding.
      //     Payload = `application/x-nexus-preset` only.
      //
      //  2. From another *cell of this deck* — rearrange. The cell's
      //     dragStart sets `application/x-nexus-deckkey` with the
      //     source index. We detect it and swap (if target is bound)
      //     or move (if target is empty).
      //
      // Detection: only the marker payload reveals intent. Browser
      // tiles never set the deckkey marker, so the absence of it
      // means a fresh drop even if the user happens to drag from
      // another tab.
      const moveMarker = e.dataTransfer.getData(
        "application/x-nexus-deckkey"
      );
      const presetRaw = e.dataTransfer.getData("application/x-nexus-preset");

      try {
        if (moveMarker) {
          // Intra-deck rearrange.
          const { sourceIndex } = JSON.parse(moveMarker) as {
            sourceIndex: number;
          };
          if (sourceIndex === targetIndex) return;
          const sourceBinding = draft.bindings[sourceIndex];
          if (!sourceBinding) return; // shouldn't happen
          const targetBinding = draft.bindings[targetIndex];
          const nextBindings: typeof draft.bindings = { ...draft.bindings };
          if (targetBinding) {
            // Swap.
            nextBindings[sourceIndex] = targetBinding;
            nextBindings[targetIndex] = sourceBinding;
          } else {
            // Move.
            delete nextBindings[sourceIndex];
            nextBindings[targetIndex] = sourceBinding;
          }
          setDraft({ ...draft, bindings: nextBindings });
          setDirty(true);
          // Pass the FRESH binding for each side of the move/swap.
          // The cleared source goes `null`; the new occupant carries
          // its binding straight to hardware.
          queueKeyPush(sourceIndex, nextBindings[sourceIndex] ?? null);
          queueKeyPush(targetIndex, nextBindings[targetIndex] ?? null);
          return;
        }

        if (presetRaw) {
          const preset = JSON.parse(presetRaw) as PresetPayload;
          const existing = draft.bindings[targetIndex];
          let next: DeckBinding;
          if (existing) {
            // Occupied key → APPEND this preset's actions to the
            // button's action list (a button can trigger several
            // things). Each appended step is tagged with its kind so a
            // cross-kind button (vMix cut + OBS scene) dispatches each
            // action to the right device. The button keeps its
            // original face.
            const taggedSteps = preset.steps.map((s) => ({
              ...s,
              kind: s.actionId.includes(":")
                ? s.actionId.slice(0, s.actionId.indexOf(":"))
                : preset.kind,
            }));
            next = {
              ...existing,
              preset: {
                ...existing.preset,
                steps: [...existing.preset.steps, ...taggedSteps],
              },
            };
          } else {
            // Empty key → fresh binding from the dropped preset.
            next = { preset } as DeckBinding;
          }
          setDraft({
            ...draft,
            bindings: {
              ...draft.bindings,
              [targetIndex]: next,
            },
          });
          setDirty(true);
          queueKeyPush(targetIndex, next);
        }
      } catch {
        /* malformed payload — silently ignore */
      }
    },
    [queueKeyPush]
  );

  const handleClear = useCallback(
    (keyIndex: number) => {
      const draft = draftRef.current;
      if (!draft) return;
      const next = { ...draft.bindings };
      delete next[keyIndex];
      setDraft({ ...draft, bindings: next });
      setDirty(true);
      queueKeyPush(keyIndex, null);
      // Drop the selection if it pointed to the cleared key.
      setSelectedKey((cur) => (cur === keyIndex ? null : cur));
    },
    [queueKeyPush]
  );

  // Inspector callback: replace a binding's preset payload after the
  // operator edited its options / face. Push the binding directly so
  // hardware reflects the change instantly, even before the
  // debounced save persists it server-side.
  const handleUpdateBinding = useCallback(
    (keyIndex: number, nextBinding: DeckBinding) => {
      const draft = draftRef.current;
      if (!draft) return;
      setDraft({
        ...draft,
        bindings: { ...draft.bindings, [keyIndex]: nextBinding },
      });
      setDirty(true);
      queueKeyPush(keyIndex, nextBinding);
    },
    [queueKeyPush]
  );

  // ── Copy / paste a key binding (duplicate shortcuts) ──
  const [clipboard, setClipboard] = useState<DeckBinding | null>(null);
  const copyKey = useCallback((keyIndex: number) => {
    const b = draftRef.current?.bindings[keyIndex];
    if (!b) return;
    setClipboard(structuredClone(b));
  }, []);
  const pasteKey = useCallback(
    (keyIndex: number) => {
      if (!clipboard) return;
      handleUpdateBinding(keyIndex, structuredClone(clipboard));
    },
    [clipboard, handleUpdateBinding]
  );

  // Stable per-key grid handlers (index passed at call time) so every
  // `DeckKey` receives the SAME function references and the memo holds.
  const onKeyDragOver = useCallback((i: number, e: React.DragEvent) => {
    e.preventDefault();
    // `types` is readable during dragover (the data isn't, by browser
    // policy). Route the drop effect: intra-deck rearrange → "move",
    // browser tile → "copy". A mismatch with the source's
    // `effectAllowed` makes the browser reject the drop silently.
    const isMove = e.dataTransfer.types.includes(
      "application/x-nexus-deckkey"
    );
    e.dataTransfer.dropEffect = isMove ? "move" : "copy";
    setHoverKey(i);
  }, []);
  const onKeyDragLeave = useCallback((i: number) => {
    setHoverKey((cur) => (cur === i ? null : cur));
  }, []);
  const onKeySelect = useCallback((i: number) => setSelectedKey(i), []);

  // Ctrl/Cmd+C / +V on the selected key — skipped while typing in a
  // field so it never hijacks normal text copy/paste in the inspector.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selectedKey === null) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        copyKey(selectedKey);
      } else if (k === "v") {
        pasteKey(selectedKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedKey, copyKey, pasteKey]);

  const handleFire = useCallback(
    async (keyIndex: number, binding: DeckBinding) => {
      setFire({ kind: "running", keyIndex });
      let next: FireState;
      try {
        // Fire the BINDING's steps (which carry the inspector's
        // per-key overrides), not the catalog's pristine preset.
        // Using `/api/presets/run` with globalId would re-fetch the
        // defaults and silently ignore every option the operator
        // edited in the inspector.
        const res = await fetch("/api/bindings/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: binding.preset.kind,
            steps: binding.preset.steps,
            // Button-level target; per-step pins (carried inside the
            // steps) still take precedence in runSteps.
            connectionId: binding.connectionId,
          }),
        });
        const json = (await res.json()) as {
          results: Array<{ ok: boolean; error?: string }>;
        };
        const failed = json.results.find((r) => !r.ok);
        next = failed
          ? { kind: "err", keyIndex, error: failed.error ?? "unknown" }
          : { kind: "ok", keyIndex };
      } catch (err) {
        next = {
          kind: "err",
          keyIndex,
          error: err instanceof Error ? err.message : "network",
        };
      }
      setFire(next);
      const captured = keyIndex;
      const delay = next.kind === "err" ? FIRE_ERROR_MS : FIRE_FEEDBACK_MS;
      setTimeout(() => {
        setFire((cur) =>
          cur.kind !== "idle" && cur.keyIndex === captured
            ? { kind: "idle" }
            : cur
        );
      }, delay);
    },
    []
  );

  const handleAddDeck = useCallback(() => {
    if (!data) return;
    const id = `layout-${Date.now()}`;
    const fresh: DeckLayout = {
      id,
      model: "xl",
      label: `Layout ${data.layouts.length + 1}`,
      bindings: {},
    };
    setData({ ...data, layouts: [...data.layouts, fresh] });
    setSelectedId(id);
    setDraft(fresh);
    setDirty(true);
  }, [data]);

  // Confirmation uses the SW design system modal so the dialog
  // matches the rest of the app instead of the OS-native prompt.
  const confirm = useConfirm();

  // Delete a specific page by id (from the Pages rail). Mirrors
  // handleDeleteDeck but works on any page, not just the selected one.
  const handleDeletePage = useCallback(
    async (id: string) => {
      if (!data) return;
      if (data.layouts.length === 1) {
        await confirm({
          title: "Can't delete the last page",
          message:
            "There's only one page left. Clear its bindings instead, or create a second page first.",
          confirmLabel: "OK",
          infoOnly: true,
        });
        return;
      }
      const target = data.layouts.find((l) => l.id === id);
      const ok = await confirm({
        title: `Delete page "${target?.label ?? id}"?`,
        message:
          "All bindings on this page will be lost. Paired devices stay connected.",
        dangerous: true,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      try {
        const res = await fetch(
          `/api/streamdeck/layouts?id=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        if (!res.ok) return;
        const remaining = data.layouts.filter((l) => l.id !== id);
        setData({ ...data, layouts: remaining });
        if (selectedId === id) {
          setSelectedId(remaining[0].id);
          setDraft(remaining[0]);
          setDirty(false);
        }
      } catch {
        /* retry via the rail */
      }
    },
    [data, confirm, selectedId]
  );

  // Persist a single layout immediately (used by rename + import).
  const persistLayout = useCallback(async (layout: DeckLayout) => {
    try {
      const res = await fetch("/api/streamdeck/layouts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout }),
      });
      if (res.ok) {
        const json = (await res.json()) as { store: { layouts: DeckLayout[] } };
        setData((cur) => (cur ? { ...cur, layouts: json.store.layouts } : cur));
      }
    } catch {
      /* surfaced via save chip on next selected-page edit */
    }
  }, []);

  // Rename any page (selected or not) from the rail.
  const renameLayout = useCallback(
    (id: string, label: string) => {
      if (!data) return;
      const target = data.layouts.find((l) => l.id === id);
      if (!target) return;
      const updated = { ...target, label };
      setData({
        ...data,
        layouts: data.layouts.map((l) => (l.id === id ? updated : l)),
      });
      if (selectedId === id) setDraft((d) => (d ? { ...d, label } : d));
      void persistLayout(updated);
    },
    [data, selectedId, persistLayout]
  );

  // ── Export ──
  const exportToFile = useCallback(
    (scope: "current" | "all") => {
      if (!data) return;
      const layouts =
        scope === "all"
          ? data.layouts
          : data.layouts.filter((l) => l.id === selectedId);
      if (layouts.length === 0) return;
      const file: DeckExportFile = {
        type: "nexus-deck",
        version: 1,
        layouts: layouts.map((l) => ({ ...l, deviceSerial: undefined })),
        connections: collectConnRefs(layouts, connections),
      };
      const blob = new Blob([JSON.stringify(file, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        scope === "all"
          ? "nexus-deck-all-pages.json"
          : `nexus-deck-${(layouts[0].label || "page").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [data, selectedId, connections]
  );

  // ── Import ──
  const [importData, setImportData] = useState<DeckExportFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onPickImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as DeckExportFile;
        if (parsed?.type !== "nexus-deck" || !Array.isArray(parsed.layouts)) {
          await confirm({
            title: "Not a Nexus deck file",
            message:
              "This file doesn't look like a Nexus deck export. Pick a .json exported from the Deck page.",
            confirmLabel: "OK",
            infoOnly: true,
          });
          return;
        }
        setImportData(parsed);
      } catch {
        await confirm({
          title: "Couldn't read file",
          message: "The file couldn't be parsed as JSON.",
          confirmLabel: "OK",
          infoOnly: true,
        });
      }
    },
    [confirm]
  );

  // Apply an import after the user resolved the connection remap.
  const applyImport = useCallback(
    async (payload: DeckExportFile, mapping: Record<string, string>) => {
      if (!data) return;
      const localIds = new Set(connections.map((c) => c.id));
      const mapStep = (
        oldId: string | undefined,
        kind: string
      ): string | undefined => {
        // Default-bucket choice for this kind ("" / undefined = keep
        // running on the kind default with no explicit pin).
        const bucket = mapping[defaultBucketKey(kind)] || undefined;
        if (oldId) {
          const mapped = mapping[oldId];
          if (mapped) return mapped; // explicit per-instance choice
          if (localIds.has(oldId)) return oldId; // same id exists here
          return bucket; // unknown pin → fall back to the kind's bucket
        }
        // Unpinned action → honour the kind's default-bucket choice.
        return bucket;
      };
      const base = Date.now();
      const existingLabels = new Set(data.layouts.map((l) => l.label));
      const imported = payload.layouts.map((l, i) => {
        let label = l.label || `Page ${i + 1}`;
        while (existingLabels.has(label)) label = `${label} (imported)`;
        existingLabels.add(label);
        return remapLayout({ ...l, label }, `layout-${base}-${i}`, mapStep);
      });
      for (const l of imported) {
        await persistLayout(l);
      }
      if (imported[0]) {
        setSelectedId(imported[0].id);
        setDraft(imported[0]);
        setDirty(false);
      }
      setImportData(null);
    },
    [data, connections, persistLayout]
  );

  // ── Load-to-device modal ──
  const [loadModalOpen, setLoadModalOpen] = useState(false);

  if (!data || !draft || !geometry) {
    return (
      <div className="flex flex-col">
        <TopBar
          status="offline"
          num="09"
          label="Surface"
          title="Stream Deck"
          sub="loading"
        />
        <div className="text-[13px] text-sw-muted py-12 text-center">
          Loading layouts…
        </div>
      </div>
    );
  }

  const filledCount = Object.keys(draft.bindings).length;
  const totalKeys = geometry.rows * geometry.cols;

  return (
    <div className="flex flex-col" style={{ height: "100vh", minHeight: 0 }}>
      <TopBar
        status="offline"
        num="09"
        label="Surface"
        title={
          <>
            {draft.label}{" "}
            <span className="text-sw-muted font-light">
              · {filledCount}/{totalKeys}
            </span>
          </>
        }
        sub={
          dirty
            ? "unsaved changes · auto-saving…"
            : "drag a preset from the right panel onto any key"
        }
      />

      <EditorToolbar
        label={draft.label}
        browserOpen={browserOpen}
        fileInputRef={fileInputRef}
        onLoadToDeck={() => setLoadModalOpen(true)}
        onImportClick={() => fileInputRef.current?.click()}
        onExportCurrent={() => exportToFile("current")}
        onExportAll={() => exportToFile("all")}
        onPickImportFile={(f) => void onPickImportFile(f)}
        onLabelChange={(label) => {
          setDraft({ ...draft, label });
          setDirty(true);
        }}
        onToggleBrowser={toggleBrowser}
      />

      {/* Main work area — deck mockup left, preset browser right.
          Both columns own their own scroll so the deck stays
          visible while the browser scrolls through categories. */}
      <div
        className="flex"
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--bg)",
        }}
      >
        {/* Pages rail — page list: click to switch,
            inline rename, add, delete, with a pairing dot. */}
        <PagesRail
          layouts={data.layouts}
          selectedId={selectedId}
          hw={hw}
          onSelect={setSelectedId}
          onAdd={handleAddDeck}
          onRename={renameLayout}
          onDelete={handleDeletePage}
        />

        {/* Deck column */}
        <div
          className="flex flex-col"
          style={{ flex: 1, minWidth: 0, overflow: "auto" }}
        >
          <div
            className="flex items-center justify-center"
            style={{ padding: 48, flex: 1 }}
          >
            <div
              style={{
                padding: 28,
                background: "linear-gradient(180deg, #2a2a2c, #1c1c1e)",
                border: "1px solid #000",
                borderRadius: 14,
                boxShadow:
                  "0 10px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              <div
                className="grid"
                style={{
                  gap: 8,
                  gridTemplateColumns: `repeat(${geometry.cols}, 84px)`,
                  gridTemplateRows: `repeat(${geometry.rows}, 84px)`,
                }}
              >
                {Array.from({ length: totalKeys }, (_, i) => {
                  const binding = draft.bindings[i];
                  // Evaluate the same feedback the hardware coordinator
                  // applies, so the mockup tile mirrors what the deck
                  // shows in real time (tally PGM/PVW, stream/rec
                  // active, current OBS scene, ...).
                  const override = binding
                    ? evaluateFeedback(
                        binding,
                        vars,
                        connectionIdsByKind,
                        defaultsByKind
                      )
                    : null;
                  return (
                    <DeckKey
                      key={i}
                      index={i}
                      binding={binding}
                      override={override}
                      hovered={hoverKey === i}
                      selected={selectedKey === i}
                      fire={fire}
                      onDragOver={onKeyDragOver}
                      onDragLeave={onKeyDragLeave}
                      onDrop={handleDrop}
                      onClear={handleClear}
                      onSelect={onKeySelect}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          {/* Tips */}
          <div
            className="px-[24px] py-[10px] sw-hairline-top"
            style={{ background: "var(--panel)", color: "var(--muted)" }}
          >
            <div className="flex items-center gap-2 text-[11px] flex-wrap">
              <Eyebrow tone="muted">Tips</Eyebrow>
              <span>Drag tiles from the right panel onto any key.</span>
              <span style={{ marginLeft: 8 }}>•</span>
              <span>Click a bound key to fire it.</span>
              <span>•</span>
              <span>Right-click to clear.</span>
            </div>
          </div>
        </div>

        {/* Side panel — tabbed Inspector + Browser. */}
        {browserOpen && (
          <aside
            className="flex flex-col"
            style={{
              width: 380,
              minWidth: 320,
              maxWidth: 480,
              flexShrink: 0,
              borderLeft: "1px solid var(--line)",
              background: "var(--bg)",
              minHeight: 0,
            }}
          >
            {/* Tab strip */}
            <div
              className="flex sw-hairline-bottom"
              style={{ background: "var(--panel)" }}
            >
              {(["inspector", "browser"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSidebarTab(t)}
                  className="font-mono uppercase transition-colors"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    fontSize: 10,
                    letterSpacing: "1.4px",
                    fontWeight: 600,
                    background:
                      sidebarTab === t ? "var(--card)" : "transparent",
                    color: sidebarTab === t ? "var(--ink)" : "var(--mid)",
                    border: 0,
                    borderBottom:
                      sidebarTab === t
                        ? "2px solid var(--amber)"
                        : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  {t === "inspector"
                    ? selectedKey !== null
                      ? `Inspector · Key ${selectedKey + 1}`
                      : "Inspector"
                    : "Browser"}
                </button>
              ))}
            </div>

            {/* Body — switches based on tab */}
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              {sidebarTab === "inspector" ? (
                <KeyInspector
                  keyIndex={selectedKey}
                  binding={
                    selectedKey !== null ? draft.bindings[selectedKey] : undefined
                  }
                  connections={connections}
                  defaultsByKind={defaultsByKind}
                  onChange={(b) => {
                    if (selectedKey === null) return;
                    handleUpdateBinding(selectedKey, b);
                  }}
                  onTest={() => {
                    if (selectedKey === null) return;
                    const b = draft.bindings[selectedKey];
                    if (b) handleFire(selectedKey, b);
                  }}
                  onClear={() => {
                    if (selectedKey !== null) handleClear(selectedKey);
                  }}
                  onClose={() => setSelectedKey(null)}
                  onPickBrowser={() => setSidebarTab("browser")}
                  onCopy={() => {
                    if (selectedKey !== null) copyKey(selectedKey);
                  }}
                  onPaste={() => {
                    if (selectedKey !== null) pasteKey(selectedKey);
                  }}
                  canPaste={clipboard !== null}
                  fire={fire}
                />
              ) : (
                <PresetBrowserPanel mode="sidebar" />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Import remap modal */}
      {importData && (
        <ImportModal
          payload={importData}
          connections={connections}
          defaultsByKind={defaultsByKind}
          onCancel={() => setImportData(null)}
          onConfirm={(mapping) => void applyImport(importData, mapping)}
        />
      )}

      {/* Load-to-device modal */}
      {loadModalOpen && (
        <LoadToDeckModal
          layouts={data.layouts}
          hw={hw}
          selectedId={selectedId}
          onClose={() => setLoadModalOpen(false)}
          onLoad={async (layoutId, serial) => {
            // Pair the chosen page to the device, then push it.
            const target = data.layouts.find((l) => l.id === layoutId);
            if (!target) return;
            // Auto-detect the model from the deck we're loading onto
            // (no manual model picker). Map the
            // device's reported model id onto a known geometry; fall
            // back to the page's existing model if it's unknown.
            const dev = hw?.devices.find((d) => d.serialNumber === serial);
            const detectedModel =
              dev && data.geometries[dev.model]
                ? (dev.model as DeckModel)
                : target.model;
            const paired = {
              ...target,
              deviceSerial: serial,
              model: detectedModel,
            };
            await persistLayout(paired);
            if (selectedId === layoutId) {
              setDraft((d) =>
                d ? { ...d, deviceSerial: serial, model: detectedModel } : d
              );
            }
            await fetch("/api/streamdeck/push", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ layoutId }),
            }).catch(() => {});
            setLoadModalOpen(false);
            void refreshHardware();
          }}
        />
      )}
    </div>
  );
}

