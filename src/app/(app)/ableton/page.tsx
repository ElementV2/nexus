"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useAbletonStore } from "@/stores/ableton-store";
import { TopBar, Section, SecondaryButton, ToolbarSlot } from "@/components/sw";
import { ClipCell } from "@/components/ableton/clip-cell";
import { InstallGuide } from "@/components/ableton/install-guide";
import { TransportBar } from "@/components/ableton/transport-bar";
import { sendAbletonCommand } from "@/lib/ableton/api";
import { RefreshCw, Square, Wifi } from "lucide-react";

// Fixed column widths — guarantees byte-perfect column alignment between
// the sticky header row, the scene rows, and the sticky stop row even
// though they live in three independent CSS grids.
const TRACK_COL_PX = 160;
const ROW_GAP_PX = 4;
const ROW_PAD_X = 12;

const fireClip = (track: number, scene: number) =>
  sendAbletonCommand({ action: "fire-clip", track, scene });
const stopTrack = (track: number) =>
  sendAbletonCommand({ action: "stop-track", track });
const stopAll = () => sendAbletonCommand({ action: "stop-all" });
const refreshSnapshot = () =>
  sendAbletonCommand({ action: "refresh-snapshot" });

export default function AbletonPage() {
  const status = useAbletonStore((s) => s.status);
  const host = useAbletonStore((s) => s.host);
  const port = useAbletonStore((s) => s.port);
  const version = useAbletonStore((s) => s.version);
  const error = useAbletonStore((s) => s.error);
  const snapshot = useAbletonStore((s) => s.snapshot);
  const positions = useAbletonStore((s) => s.positions);
  const pendingClips = useAbletonStore((s) => s.pendingClips);
  const markPending = useAbletonStore((s) => s.markPending);
  const clearPending = useAbletonStore((s) => s.clearPending);
  // Subscribe to tempo alone — Zustand's strict-equality bail means
  // this selector only triggers a re-render when the tempo number
  // actually changes (not on every songBeat resync).
  const tempo = useAbletonStore((s) => s.transport?.tempo ?? 120);

  // Per-track safety timers for the optimistic "pending" cue. If
  // Ableton never confirms (transport stopped, empty clip slot, OSC
  // packet lost) we clear the blinking cue after 8 s so the cell
  // doesn't stay queued forever. 8 s covers a 4-bar launch quantize
  // at 60 BPM with margin to spare.
  const pendingTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  useEffect(() => {
    // Snapshot the ref so the cleanup closure doesn't dereference a
    // potentially-replaced ref.current at unmount time.
    const timers = pendingTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Re-snapshot when the tab regains focus. AbletonOSC doesn't notify
  // us about clip add/remove or track/scene count changes, so the
  // cached grid drifts as soon as the user edits the Live session.
  // Coming back to this tab is the strongest signal that they just
  // finished editing. The broker's snapshotInFlight guard absorbs
  // rapid-fire visibility flips.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSnapshot();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const onFire = useCallback(
    (track: number, scene: number) => {
      markPending(track, scene);
      const existing = pendingTimers.current.get(track);
      if (existing) clearTimeout(existing);
      pendingTimers.current.set(
        track,
        setTimeout(() => {
          clearPending(track);
          pendingTimers.current.delete(track);
        }, 8000)
      );
      fireClip(track, scene);
    },
    [markPending, clearPending]
  );

  const topBarStatus =
    status === "connected" ? "live" : status === "connecting" ? "booting" : "offline";
  const targetLabel = `${host}:${port}`;

  // ─── Disconnected state — show install guide + settings ─────────
  if (status !== "connected" || !snapshot) {
    return (
      <div className="flex flex-col">
        <TopBar
          status={topBarStatus}
          num="11"
          label="Ableton"
          title={
            status === "connecting" ? "Connecting…" : "Not connected"
          }
          sub={targetLabel}
        />
        <Section>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              maxWidth: 720,
              margin: "0 auto",
              paddingTop: 16,
              paddingBottom: 16,
            }}
          >
            {error && (
              <div
                style={{
                  padding: "12px",
                  background: "var(--pgm-tint)",
                  color: "var(--pgm)",
                  border: "1px solid var(--pgm)",
                  fontSize: 12,
                }}
              >
                {error}
              </div>
            )}
            {/* Connection settings live on the Network page now —
                single source of truth for both vMix and Ableton. */}
            <div
              style={{
                padding: 16,
                background: "var(--card)",
                border: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="label" style={{ marginBottom: 4 }}>
                  Target
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink)",
                  }}
                >
                  {targetLabel}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    marginTop: 4,
                  }}
                >
                  Edit the host / ports + run a connection test on the Network
                  page.
                </div>
              </div>
              <Link
                href="/network"
                className="font-mono uppercase transition-colors inline-flex items-center"
                style={{
                  gap: 8,
                  padding: "12px 16px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "1.4px",
                  background: "var(--amber-tint)",
                  color: "var(--amber)",
                  border: "1px solid var(--amber)",
                  textDecoration: "none",
                  transitionDuration: "80ms",
                }}
              >
                <Wifi size={12} strokeWidth={1.5} />
                Network
              </Link>
            </div>
            <InstallGuide />
          </div>
        </Section>
      </div>
    );
  }

  // ─── Connected — show the clip launchpad grid ───────────────────
  const { tracks, scenes } = snapshot;
  const cols = `repeat(${tracks.length}, ${TRACK_COL_PX}px)`;

  return (
    <div className="flex flex-col" style={{ height: "100%" }}>
      <TopBar
        status="live"
        num="11"
        label="Ableton"
        title={
          <>
            {tracks.length}{" "}
            <span className="text-sw-muted font-light">Tracks.</span>
          </>
        }
        sub={`${scenes.length} scenes${version ? ` · Live ${version}` : ""} · ${targetLabel}`}
        right={
          <>
            <ToolbarSlot label="Transport">
              <SecondaryButton onClick={stopAll}>
                <span className="inline-flex items-center" style={{ gap: 6 }}>
                  <Square size={11} strokeWidth={1.5} /> Stop all
                </span>
              </SecondaryButton>
            </ToolbarSlot>
            <ToolbarSlot label="Session">
              <SecondaryButton
                onClick={refreshSnapshot}
                title="Refresh session structure (clip add/remove, renames)"
              >
                <span className="inline-flex items-center" style={{ gap: 6 }}>
                  <RefreshCw size={11} strokeWidth={1.5} /> Refresh
                </span>
              </SecondaryButton>
            </ToolbarSlot>
          </>
        }
      />

      <TransportBar />

      {/* Scrollable area — owns both axes so the sticky rows track this
          container, not the page's outer <main>. The header pins to its
          top, the stop row pins to its bottom; only the scene rows in
          between actually scroll. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
        }}
      >
        {/* Header row: scene-col placeholder + one cell per track. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: cols,
            gap: ROW_GAP_PX,
            padding: `12px ${ROW_PAD_X}px`,
            background: "var(--panel)",
            borderBottom: "1px solid var(--line)",
            position: "sticky",
            top: 0,
            zIndex: 3,
            width: "max-content",
            minWidth: "100%",
          }}
        >
          {tracks.map((t) => (
            <div
              key={t.index}
              className="font-mono uppercase truncate"
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "1.4px",
                color: "var(--ink)",
                padding: "4px 6px",
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                textAlign: "center",
              }}
              title={t.name}
            >
              {String(t.index + 1).padStart(2, "0")} · {t.name}
            </div>
          ))}
        </div>

        {/* Scene rows — the only section that actually scrolls. */}
        <div
          style={{
            padding: `12px ${ROW_PAD_X}px`,
            display: "flex",
            flexDirection: "column",
            gap: ROW_GAP_PX,
            width: "max-content",
            minWidth: "100%",
          }}
        >
          {scenes.map((scene, sIdx) => (
            <div
              key={scene.index}
              style={{
                display: "grid",
                gridTemplateColumns: cols,
                gap: ROW_GAP_PX,
              }}
            >
              {tracks.map((t) => {
                const slot = t.slots[sIdx] ?? { hasClip: false };
                const isPlaying = t.playingSlotIndex === sIdx;
                const sample = positions.get(t.index);
                const isPending = pendingClips.get(t.index) === sIdx;
                // Pass coordinates as props + stable `onFire`. The
                // cell binds the click closure internally so the
                // React.memo equality below stays bailable.
                return (
                  <ClipCell
                    key={`${t.index}-${sIdx}`}
                    slot={slot}
                    trackIndex={t.index}
                    sceneIndex={sIdx}
                    isPlaying={isPlaying}
                    isPending={isPending}
                    onFire={onFire}
                    positionSample={
                      isPlaying && sample?.clipIndex === sIdx ? sample : undefined
                    }
                    tempo={tempo}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Stop-track row — same grid template as the header so columns
            stay byte-aligned. Sticky bottom: 0 keeps it pinned to the
            visible viewport even on long sessions. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: cols,
            gap: ROW_GAP_PX,
            padding: `12px ${ROW_PAD_X}px`,
            background: "var(--panel)",
            borderTop: "1px solid var(--line)",
            position: "sticky",
            bottom: 0,
            zIndex: 3,
            width: "max-content",
            minWidth: "100%",
          }}
        >
          {tracks.map((t) => (
            <button
              key={t.index}
              onClick={() => stopTrack(t.index)}
              className="font-mono uppercase transition-colors"
              style={{
                padding: "8px 12px",
                fontSize: 10,
                letterSpacing: "1.4px",
                background: "var(--card)",
                color: "var(--mid)",
                border: "1px solid var(--line-hi)",
                transitionDuration: "80ms",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
              aria-label={`Stop track ${t.name}`}
            >
              <Square size={10} strokeWidth={1.5} /> Stop
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
