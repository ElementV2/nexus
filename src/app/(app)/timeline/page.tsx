"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar, useConfirm } from "@/components/sw";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useConnections } from "@/hooks/use-connections";
import { useActionCatalog } from "@/app/(app)/streamdeck/_components/action-catalog";
import type { ConnectionLite } from "@/app/(app)/streamdeck/_components/types";
import { PageSwitcher } from "@/components/page-switcher";
import {
  readSurfaceClipboard,
  writeSurfaceClipboard,
  bindingToClips,
} from "@/lib/clipboard/surface-clipboard";
import { TimelineCanvas } from "./_components/TimelineCanvas";
import { ClipInspector } from "./_components/ClipInspector";
import { TransportBar } from "./_components/TransportBar";
import { ActionPalette } from "./_components/ActionPalette";
import type {
  Scenario,
  Selection,
  TimelineClip,
  Track,
  TransportSnapshot,
} from "./_components/types";
import { defaultOptions } from "./_components/types";

function newId(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

/** localStorage key: the show selected last, restored across route changes. */
const LAST_SHOW_KEY = "nexus.show.scenario";

const ZOOMS = [0.02, 0.04, 0.08, 0.14, 0.24];
const IDLE_TRANSPORT: TransportSnapshot = {
  scenarioId: null,
  state: "idle",
  playheadMs: 0,
  durationMs: 0,
  skipWaits: false,
  waitingAtMs: null,
};

export default function TimelinePage() {
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("default");
  const [selection, setSelection] = useState<Selection>(null);
  const [transport, setTransport] = useState<TransportSnapshot>(IDLE_TRANSPORT);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [tab, setTab] = useState<"inspect" | "actions">("actions");

  const actions = useActionCatalog();
  const { data: connData } = useConnections();
  const connections: ConnectionLite[] = useMemo(
    () =>
      (connData?.connections ?? []).map((c) => ({
        id: c.id,
        kind: c.kind,
        label: c.label,
        enabled: c.enabled,
      })),
    [connData]
  );

  const pxPerMs = ZOOMS[zoomIdx];
  const selected = scenarios?.find((s) => s.id === selectedId) ?? null;
  const confirm = useConfirm();

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/timeline/scenarios", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ scenarios: Scenario[] }>)
      .then((j) => {
        if (cancelled) return;
        setScenarios(j.scenarios);
        // Restore the show selected last session so navigating to /streamdeck
        // and back keeps your show.
        const saved =
          typeof window !== "undefined"
            ? window.localStorage.getItem(LAST_SHOW_KEY)
            : null;
        const pick =
          j.scenarios.find((s) => s.id === saved)?.id ??
          (j.scenarios.some((s) => s.id === selectedId)
            ? selectedId
            : j.scenarios[0]?.id);
        if (pick) setSelectedId(pick);
        didRestore.current = true;
      })
      .catch(() => {
        if (!cancelled) setScenarios([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the selected show (after restore) so it survives a route change.
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(LAST_SHOW_KEY, selectedId);
      } catch {
        /* private mode / quota — selection just won't persist */
      }
    }
  }, [selectedId]);

  // ── Transport SSE ──
  useEffect(() => {
    const es = new EventSource("/api/timeline/transport");
    es.onmessage = (e) => {
      try {
        setTransport(JSON.parse(e.data) as TransportSnapshot);
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects */
    };
    return () => es.close();
  }, []);

  // The transport snapshot only applies to the scenario the engine loaded.
  const isActive = transport.scenarioId === selectedId;
  const viewState = isActive ? transport.state : "idle";
  const viewPlayhead = isActive ? transport.playheadMs : 0;
  // Latest playhead in a ref so paste can read it without re-creating the
  // keyboard handler on every SSE tick.
  const playheadRef = useRef(viewPlayhead);
  playheadRef.current = viewPlayhead;

  // ── Autosave (debounced PUT of the edited scenario) ──
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const scheduleSave = useCallback((scenario: Scenario) => {
    const timers = saveTimers.current;
    const existing = timers.get(scenario.id);
    if (existing) clearTimeout(existing);
    timers.set(
      scenario.id,
      setTimeout(() => {
        timers.delete(scenario.id);
        void fetch("/api/timeline/scenarios", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario }),
        }).catch(() => {
          /* best effort — next edit retries */
        });
      }, 400)
    );
  }, []);

  /** Apply a mutation to the selected scenario, keep duration covering the
   *  furthest cue, update state and schedule a save. */
  const mutate = useCallback(
    (fn: (s: Scenario) => Scenario) => {
      setScenarios((prev) => {
        if (!prev) return prev;
        let saved: Scenario | null = null;
        const next = prev.map((s) => {
          if (s.id !== selectedId) return s;
          const m = fn(structuredClone(s));
          const furthest = Math.max(
            0,
            ...m.tracks.flatMap((t) => t.clips.map((c) => c.offsetMs)),
            ...m.waits.map((w) => w.offsetMs)
          );
          m.durationMs = Math.max(m.durationMs, furthest + 2000);
          saved = m;
          return m;
        });
        if (saved) scheduleSave(saved);
        return next;
      });
    },
    [selectedId, scheduleSave]
  );

  // ── Scenario CRUD ──
  const addScenario = useCallback(() => {
    const id = newId("show");
    const fresh: Scenario = {
      id,
      label: `Show ${(scenarios?.length ?? 0) + 1}`,
      durationMs: 60_000,
      tracks: [{ id: "track-1", label: "Track 1", clips: [] }],
      waits: [],
    };
    setScenarios((prev) => [...(prev ?? []), fresh]);
    setSelectedId(id);
    setSelection(null);
    void fetch("/api/timeline/scenarios", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: fresh }),
    }).catch(() => {});
  }, [scenarios]);

  const renameScenario = useCallback(
    (id: string, label: string) => {
      setScenarios((prev) => {
        if (!prev) return prev;
        let saved: Scenario | null = null;
        const next = prev.map((s) => {
          if (s.id !== id) return s;
          saved = { ...s, label };
          return saved;
        });
        if (saved) scheduleSave(saved);
        return next;
      });
    },
    [scheduleSave]
  );

  const deleteScenario = useCallback(
    async (id: string) => {
      if ((scenarios?.length ?? 0) <= 1) {
        await confirm({
          title: "Can't delete the last show",
          message:
            "There's only one show left. Create a second one first, then delete this.",
          confirmLabel: "OK",
          infoOnly: true,
        });
        return;
      }
      const target = scenarios?.find((s) => s.id === id);
      const ok = await confirm({
        title: `Delete show "${target?.label ?? id}"?`,
        message: "All its tracks, cues and WAIT markers will be lost.",
        dangerous: true,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      // Cancel any pending autosave for this show so it isn't re-created.
      const t = saveTimers.current.get(id);
      if (t) {
        clearTimeout(t);
        saveTimers.current.delete(id);
      }
      void fetch(`/api/timeline/scenarios?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }).catch(() => {});
      setScenarios((prev) => {
        const next = (prev ?? []).filter((s) => s.id !== id);
        if (id === selectedId && next[0]) setSelectedId(next[0].id);
        return next;
      });
      setSelection(null);
    },
    [scenarios, selectedId, confirm]
  );

  // ── Clip / track / wait mutations ──
  const dropAction = useCallback(
    (trackId: string, offsetMs: number, globalId: string) => {
      const entry = actions?.find((a) => a.globalId === globalId);
      if (!entry) return;
      const clip: TimelineClip = {
        id: newId("clip"),
        offsetMs,
        steps: [
          {
            actionId: entry.globalId,
            kind: entry.kind,
            // Connection is per-action: pin to the first enabled instance of
            // the kind so the inspector shows the real target (not "None").
            connectionId: connections.find(
              (c) => c.kind === entry.kind && c.enabled
            )?.id,
            options: defaultOptions(entry),
          },
        ],
      };
      mutate((s) => {
        s.tracks = s.tracks.map((t) =>
          t.id === trackId
            ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.offsetMs - b.offsetMs) }
            : t
        );
        return s;
      });
      setSelection({ kind: "clip", trackId, clipId: clip.id });
      setTab("inspect");
    },
    [actions, mutate, connections]
  );

  const moveClip = useCallback(
    (
      fromTrackId: string,
      clipId: string,
      toTrackId: string,
      offsetMs: number
    ) => {
      mutate((s) => {
        // Same track → just retime in place.
        if (fromTrackId === toTrackId) {
          s.tracks = s.tracks.map((t) =>
            t.id === fromTrackId
              ? {
                  ...t,
                  clips: t.clips.map((c) =>
                    c.id === clipId ? { ...c, offsetMs } : c
                  ),
                }
              : t
          );
          return s;
        }
        // Cross-track → pull the clip out of its track and drop it in the new
        // one at the new time.
        let moving: TimelineClip | null = null;
        s.tracks = s.tracks.map((t) => {
          if (t.id !== fromTrackId) return t;
          moving = t.clips.find((c) => c.id === clipId) ?? null;
          return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
        });
        if (!moving) return s;
        const placed: TimelineClip = { ...(moving as TimelineClip), offsetMs };
        s.tracks = s.tracks.map((t) =>
          t.id === toTrackId
            ? {
                ...t,
                clips: [...t.clips, placed].sort(
                  (a, b) => a.offsetMs - b.offsetMs
                ),
              }
            : t
        );
        return s;
      });
      // Keep the inspector pointed at the clip after it changes track.
      if (fromTrackId !== toTrackId) {
        setSelection({ kind: "clip", trackId: toTrackId, clipId });
      }
    },
    [mutate]
  );

  const updateClip = useCallback(
    (trackId: string, clipId: string, patch: Partial<TimelineClip>) => {
      mutate((s) => {
        s.tracks = s.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: t.clips.map((c) =>
                  c.id === clipId ? { ...c, ...patch } : c
                ),
              }
            : t
        );
        return s;
      });
    },
    [mutate]
  );

  const deleteClip = useCallback(
    (trackId: string, clipId: string) => {
      mutate((s) => {
        s.tracks = s.tracks.map((t) =>
          t.id === trackId
            ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
            : t
        );
        return s;
      });
      setSelection(null);
    },
    [mutate]
  );

  const addTrack = useCallback(() => {
    mutate((s) => {
      const track: Track = {
        id: newId("track"),
        label: `Track ${s.tracks.length + 1}`,
        clips: [],
      };
      s.tracks = [...s.tracks, track];
      return s;
    });
  }, [mutate]);

  const renameTrack = useCallback(
    (trackId: string, label: string) => {
      mutate((s) => {
        s.tracks = s.tracks.map((t) =>
          t.id === trackId ? { ...t, label } : t
        );
        return s;
      });
    },
    [mutate]
  );

  const addWait = useCallback(() => {
    const at = isActive ? Math.round(viewPlayhead) : 0;
    const id = newId("wait");
    mutate((s) => {
      s.waits = [...s.waits, { id, offsetMs: at }].sort(
        (a, b) => a.offsetMs - b.offsetMs
      );
      return s;
    });
    setSelection({ kind: "wait", waitId: id });
    setTab("inspect");
  }, [mutate, isActive, viewPlayhead]);

  const updateWait = useCallback(
    (waitId: string, patch: { offsetMs?: number; label?: string }) => {
      mutate((s) => {
        s.waits = s.waits
          .map((w) => (w.id === waitId ? { ...w, ...patch } : w))
          .sort((a, b) => a.offsetMs - b.offsetMs);
        return s;
      });
    },
    [mutate]
  );

  const deleteWait = useCallback(
    (waitId: string) => {
      mutate((s) => {
        s.waits = s.waits.filter((w) => w.id !== waitId);
        return s;
      });
      setSelection(null);
    },
    [mutate]
  );

  // ── Transport commands ──
  const post = useCallback((body: Record<string, unknown>) => {
    void fetch("/api/timeline/transport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, []);

  const onPlay = useCallback(
    () => post({ action: "play", scenarioId: selectedId, skipWaits: transport.skipWaits }),
    [post, selectedId, transport.skipWaits]
  );

  // ── Clipboard + delete (mirrors the deck: Ctrl/Cmd+C/V, Delete) ──
  const findSelectedClip = useCallback((): {
    clip: TimelineClip;
    trackId: string;
  } | null => {
    if (selection?.kind !== "clip") return null;
    const sc = scenarios?.find((s) => s.id === selectedId);
    const tr = sc?.tracks.find((t) => t.id === selection.trackId);
    const clip = tr?.clips.find((c) => c.id === selection.clipId);
    return clip ? { clip, trackId: selection.trackId } : null;
  }, [selection, scenarios, selectedId]);

  const copyClip = useCallback(() => {
    const found = findSelectedClip();
    if (found) {
      writeSurfaceClipboard({
        v: 1,
        kind: "show",
        clip: structuredClone(found.clip),
        trackId: found.trackId,
      });
    }
  }, [findSelectedClip]);

  /** Add one or more clips to a track and select the first. */
  const placeClips = useCallback(
    (trackId: string, clips: TimelineClip[]) => {
      if (!clips.length) return;
      mutate((s) => {
        s.tracks = s.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: [...t.clips, ...clips].sort(
                  (a, b) => a.offsetMs - b.offsetMs
                ),
              }
            : t
        );
        return s;
      });
      setSelection({ kind: "clip", trackId, clipId: clips[0].id });
      setTab("inspect");
    },
    [mutate]
  );

  const pasteClip = useCallback(() => {
    const c = readSurfaceClipboard();
    if (!c) return;
    const sc = scenarios?.find((s) => s.id === selectedId);
    if (!sc) return;
    const at = Math.max(0, Math.round(playheadRef.current));
    if (c.kind === "show") {
      // Same track it was copied from (fall back to first), at the playhead.
      const targetTrackId = sc.tracks.some((t) => t.id === c.trackId)
        ? c.trackId
        : sc.tracks[0]?.id;
      if (!targetTrackId) return;
      placeClips(targetTrackId, [
        { ...structuredClone(c.clip), id: newId("clip"), offsetMs: at },
      ]);
    } else {
      // A deck button → ONE multi-action clip at the playhead on the selected
      // track (or the first). Delays stay inside the clip and fire in sequence.
      const targetTrackId =
        (selection?.kind === "clip" ? selection.trackId : null) ??
        sc.tracks[0]?.id;
      if (!targetTrackId) return;
      placeClips(targetTrackId, bindingToClips(c.binding, at));
    }
  }, [scenarios, selectedId, selection, placeClips]);

  const deleteSelected = useCallback(() => {
    if (selection?.kind === "clip") deleteClip(selection.trackId, selection.clipId);
    else if (selection?.kind === "wait") deleteWait(selection.waitId);
  }, [selection, deleteClip, deleteWait]);

  // Keyboard shortcuts — skipped while typing in a field so they never
  // hijack text editing in the inspector.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (selection) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "c" && selection?.kind === "clip") {
        e.preventDefault();
        copyClip();
      } else if (k === "v") {
        // pasteClip self-guards on an empty clipboard.
        e.preventDefault();
        pasteClip();
      } else if (k === "x" && selection?.kind === "clip") {
        e.preventDefault();
        copyClip();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, copyClip, pasteClip, deleteSelected]);

  // Auto-switch to the inspector when something is selected.
  useEffect(() => {
    if (selection) setTab("inspect");
  }, [selection]);

  return (
    <div className="flex flex-col" style={{ height: "100%", minHeight: 0 }}>
      <TopBar
        num="LIVE"
        label="SHOW"
        title="Live Show"
        sub={selected?.label}
        status="live"
        right={
          <div className="flex items-center" style={{ padding: "0 12px", gap: 6 }}>
            <button
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              title="Zoom out"
              style={zoomBtn}
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
              title="Zoom in"
              style={zoomBtn}
            >
              <ZoomIn size={14} />
            </button>
          </div>
        }
      />

      <TransportBar
        leading={
          <PageSwitcher
            items={(scenarios ?? []).map((s) => ({
              id: s.id,
              label: s.label,
              meta: `${s.tracks.reduce((n, t) => n + t.clips.length, 0)} cues`,
              dot:
                transport.state !== "idle" && transport.scenarioId === s.id
                  ? "filled"
                  : "none",
            }))}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setSelection(null);
            }}
            onAdd={addScenario}
            onRename={renameScenario}
            onDelete={deleteScenario}
            addTitle="Add scenario"
            deleteTitle="Delete scenario"
          />
        }
        state={viewState}
        playheadMs={viewPlayhead}
        durationMs={selected?.durationMs ?? 0}
        skipWaits={transport.skipWaits}
        onPlay={onPlay}
        onPause={() => post({ action: "pause" })}
        onResume={() => post({ action: "resume" })}
        onStop={() => post({ action: "stop" })}
        onGo={() => post({ action: "go" })}
        onSeek={(ms) => post({ action: "seek", ms, scenarioId: selectedId })}
        onToggleSkip={() =>
          post({ action: "setSkipWaits", skipWaits: !transport.skipWaits })
        }
        onAddWait={addWait}
      />

      <div className="flex" style={{ flex: 1, minHeight: 0 }}>
        {selected ? (
          <TimelineCanvas
            scenario={selected}
            pxPerMs={pxPerMs}
            playheadMs={viewPlayhead}
            selection={selection}
            actions={actions}
            onSelect={setSelection}
            onDropAction={dropAction}
            onMoveClip={moveClip}
            onSeek={(ms) => post({ action: "seek", ms, scenarioId: selectedId })}
            onAddTrack={addTrack}
            onRenameTrack={renameTrack}
          />
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {/* Right panel */}
        <div
          className="flex flex-col"
          style={{
            width: 290,
            flexShrink: 0,
            borderLeft: "1px solid var(--line)",
            background: "var(--panel)",
            minHeight: 0,
          }}
        >
          <div className="flex sw-hairline-bottom">
            {(["inspect", "actions"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="font-mono uppercase"
                style={{
                  flex: 1,
                  padding: "8px 0",
                  fontSize: 9,
                  letterSpacing: "0.14em",
                  fontWeight: 700,
                  background: tab === t ? "var(--card)" : "transparent",
                  border: 0,
                  borderBottom:
                    tab === t
                      ? "2px solid var(--amber)"
                      : "2px solid transparent",
                  color: tab === t ? "var(--ink)" : "var(--sub)",
                  cursor: "pointer",
                }}
              >
                {t === "inspect" ? "Inspect" : "Actions"}
              </button>
            ))}
          </div>
          <div className="flex flex-col" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {tab === "inspect" && selected ? (
              <ClipInspector
                scenario={selected}
                selection={selection}
                connections={connections}
                actions={actions}
                onUpdateClip={updateClip}
                onDeleteClip={deleteClip}
                onUpdateWait={updateWait}
                onDeleteWait={deleteWait}
                onClose={() => setSelection(null)}
              />
            ) : (
              <ActionPalette actions={actions} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 5,
  background: "var(--panel-2)",
  border: "1px solid var(--line-hi)",
  color: "var(--mid)",
  cursor: "pointer",
};
