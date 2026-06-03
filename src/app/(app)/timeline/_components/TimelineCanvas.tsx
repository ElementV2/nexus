"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import type { ActionCatalogEntry, Scenario, Selection } from "./types";
import { ACTION_DND_MIME, clipColor, clipLabel } from "./types";

const GUTTER = 120; // track-label column width
const RULER_H = 26;
const TRACK_H = 60;

/** Round an offset to a 50 ms grid so cues land on tidy values. */
function snap(ms: number): number {
  return Math.max(0, Math.round(ms / 50) * 50);
}

export function TimelineCanvas({
  scenario,
  pxPerMs,
  playheadMs,
  selection,
  actions,
  onSelect,
  onDropAction,
  onMoveClip,
  onSeek,
  onAddTrack,
}: {
  scenario: Scenario;
  pxPerMs: number;
  playheadMs: number;
  selection: Selection;
  actions: ActionCatalogEntry[] | null;
  onSelect: (sel: Selection) => void;
  onDropAction: (trackId: string, offsetMs: number, globalId: string) => void;
  onMoveClip: (
    fromTrackId: string,
    clipId: string,
    toTrackId: string,
    offsetMs: number
  ) => void;
  onSeek: (ms: number) => void;
  onAddTrack: () => void;
}) {
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const tracksRef = useRef<HTMLDivElement | null>(null);
  // Active clip drag: which clip, its current track, and where inside the
  // clip the pointer grabbed (lane-relative px).
  const drag = useRef<{
    fromTrackId: string;
    clipId: string;
    grabDx: number;
  } | null>(null);

  const contentWidth = scenario.durationMs * pxPerMs;
  const secStep = pxPerMs > 0.05 ? 1000 : pxPerMs > 0.02 ? 5000 : 10000;

  // ── Ruler ticks ──
  const ticks: number[] = [];
  for (let t = 0; t <= scenario.durationMs; t += secStep) ticks.push(t);

  function laneOffsetFromClientX(clientX: number): number {
    const lane = lanesRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    return snap((clientX - rect.left) / pxPerMs);
  }

  function onClipPointerDown(
    e: React.PointerEvent,
    trackId: string,
    clipId: string,
    clipOffsetMs: number
  ) {
    e.stopPropagation();
    onSelect({ kind: "clip", trackId, clipId });
    const lane = lanesRef.current;
    if (!lane) return;
    // grabDx = how far INTO the clip the pointer is, in lane-relative px.
    // Both terms are lane-relative so a click with no movement leaves the
    // offset unchanged (the earlier mix of viewport + lane coords made the
    // clip jump back to 0 on select).
    const laneLeft = lane.getBoundingClientRect().left;
    drag.current = {
      fromTrackId: trackId,
      clipId,
      grabDx: e.clientX - laneLeft - clipOffsetMs * pxPerMs,
    };
    // No setPointerCapture: dragging across tracks re-parents the clip node,
    // which would drop the capture. Window listeners track the pointer
    // regardless of which element it's over.

    const move = (ev: PointerEvent) => {
      const d = drag.current;
      const laneEl = lanesRef.current;
      const tracksEl = tracksRef.current;
      if (!d || !laneEl || !tracksEl) return;

      // Horizontal: new offset from the lane's left edge.
      const rect = laneEl.getBoundingClientRect();
      const offsetMs = snap((ev.clientX - rect.left - d.grabDx) / pxPerMs);

      // Vertical: which track lane is the pointer over now?
      const tRect = tracksEl.getBoundingClientRect();
      const idx = Math.max(
        0,
        Math.min(
          scenario.tracks.length - 1,
          Math.floor((ev.clientY - tRect.top) / TRACK_H)
        )
      );
      const toTrackId = scenario.tracks[idx]?.id ?? d.fromTrackId;

      onMoveClip(d.fromTrackId, d.clipId, toTrackId, offsetMs);
      // Subsequent moves operate on the clip's new track.
      d.fromTrackId = toTrackId;
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Grab the playhead and scrub it. Jumps to the grab point immediately,
  // then follows the pointer until release. Seeks are throttled to ~40 ms
  // (the engine's resolution) so a drag doesn't flood the server with one
  // request per pointer move; the final position is always sent.
  function onPlayheadPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    let lastSent = 0;
    let pending: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = (ms: number) => {
      lastSent = performance.now();
      onSeek(ms);
    };
    const scrub = (ms: number) => {
      const since = performance.now() - lastSent;
      if (since >= 40) {
        fire(ms);
      } else {
        pending = ms;
        if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            if (pending !== null) {
              fire(pending);
              pending = null;
            }
          }, 40 - since);
        }
      }
    };
    scrub(laneOffsetFromClientX(e.clientX));
    const move = (ev: PointerEvent) => scrub(laneOffsetFromClientX(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // Always land on the final position even if it was throttled.
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending !== null) {
        fire(pending);
        pending = null;
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const playheadX = GUTTER + playheadMs * pxPerMs;

  return (
    <div
      style={{
        flex: 1,
        // Scroll the timeline HORIZONTALLY only — the tracks stay put
        // vertically so they're always visible (no vertical scroll).
        overflowX: "auto",
        overflowY: "hidden",
        background: "var(--bg)",
        minWidth: 0,
      }}
    >
      <div style={{ position: "relative", width: GUTTER + contentWidth + 200 }}>
        {/* ── Ruler ── */}
        <div
          className="flex"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 3,
            height: RULER_H,
            background: "var(--panel)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              width: GUTTER,
              flexShrink: 0,
              borderRight: "1px solid var(--line)",
              background: "var(--panel-2)",
              // Pin the top-left corner so it never scrolls away.
              position: "sticky",
              left: 0,
              zIndex: 6,
            }}
          />
          <div
            style={{ position: "relative", flex: 1, cursor: "text" }}
            onClick={(e) => onSeek(laneOffsetFromClientX(e.clientX))}
            title="Click to move the playhead"
          >
            {ticks.map((t) => (
              <div
                key={t}
                className="font-mono"
                style={{
                  position: "absolute",
                  left: t * pxPerMs,
                  top: 0,
                  height: RULER_H,
                  borderLeft: "1px solid var(--line)",
                  paddingLeft: 3,
                  fontSize: 9,
                  color: "var(--sub)",
                  lineHeight: `${RULER_H}px`,
                  userSelect: "none",
                }}
              >
                {Math.round(t / 1000)}s
              </div>
            ))}
          </div>
        </div>

        {/* ── Tracks ── */}
        <div ref={tracksRef}>
          {scenario.tracks.map((track) => (
            <div
              key={track.id}
              className="flex"
              style={{ height: TRACK_H, borderBottom: "1px solid var(--line)" }}
            >
              {/* Track header — pinned left so it stays visible while the
                  timeline scrolls horizontally. */}
              <div
                className="flex items-center font-mono"
                style={{
                  width: GUTTER,
                  flexShrink: 0,
                  padding: "0 10px",
                  fontSize: 10,
                  color: "var(--mid)",
                  background: "var(--panel)",
                  borderRight: "1px solid var(--line)",
                  letterSpacing: "0.04em",
                  position: "sticky",
                  left: 0,
                  zIndex: 5,
                }}
              >
                {track.label}
              </div>
              {/* Lane */}
              <div
                ref={track === scenario.tracks[0] ? lanesRef : undefined}
                style={{ position: "relative", flex: 1, cursor: "text" }}
                // Click on EMPTY lane space (not on a clip) → move the
                // playhead there. `target === currentTarget` keeps clicks on
                // clips from also seeking.
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    onSeek(laneOffsetFromClientX(e.clientX));
                  }
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(ACTION_DND_MIME)) {
                    e.preventDefault();
                  }
                }}
                onDrop={(e) => {
                  const gid = e.dataTransfer.getData(ACTION_DND_MIME);
                  if (!gid) return;
                  e.preventDefault();
                  onDropAction(track.id, laneOffsetFromClientX(e.clientX), gid);
                }}
              >
                {track.clips.map((clip) => {
                  const sel =
                    selection?.kind === "clip" &&
                    selection.clipId === clip.id;
                  return (
                    <div
                      key={clip.id}
                      onPointerDown={(e) =>
                        onClipPointerDown(e, track.id, clip.id, clip.offsetMs)
                      }
                      title={clipLabel(clip, actions)}
                      className="font-mono"
                      style={{
                        position: "absolute",
                        left: clip.offsetMs * pxPerMs,
                        top: 8,
                        height: TRACK_H - 16,
                        minWidth: 64,
                        maxWidth: 200,
                        padding: "4px 6px",
                        background: clipColor(clip, actions),
                        color: "#fff",
                        border: sel
                          ? "2px solid var(--amber)"
                          : "1px solid rgba(0,0,0,0.4)",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
                        cursor: "grab",
                        overflow: "hidden",
                        fontSize: 10,
                        lineHeight: 1.2,
                        touchAction: "none",
                        userSelect: "none",
                      }}
                    >
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontWeight: 600,
                        }}
                      >
                        {clipLabel(clip, actions)}
                      </div>
                      {clip.steps.length > 1 && (
                        <span
                          title={`${clip.steps.length} actions`}
                          style={{
                            position: "absolute",
                            top: 2,
                            right: 3,
                            fontSize: 8,
                            fontWeight: 700,
                            padding: "0 3px",
                            borderRadius: 2,
                            background: "rgba(0,0,0,0.45)",
                            color: "#fff",
                          }}
                        >
                          ×{clip.steps.length}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Add-track row */}
          <div className="flex" style={{ height: 32 }}>
            <button
              onClick={onAddTrack}
              className="flex items-center gap-1 font-mono uppercase"
              style={{
                width: GUTTER,
                flexShrink: 0,
                padding: "0 10px",
                fontSize: 9,
                letterSpacing: "0.1em",
                background: "var(--panel)",
                border: 0,
                borderRight: "1px solid var(--line)",
                borderBottom: "1px solid var(--line)",
                color: "var(--sub)",
                cursor: "pointer",
                position: "sticky",
                left: 0,
                zIndex: 5,
              }}
            >
              <Plus size={11} /> Track
            </button>
            <div style={{ flex: 1, borderBottom: "1px solid var(--line)" }} />
          </div>
        </div>

        {/* ── WAIT markers (overlay, full height) ── */}
        {scenario.waits.map((w) => {
          const sel = selection?.kind === "wait" && selection.waitId === w.id;
          return (
            <div
              key={w.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: "wait", waitId: w.id });
              }}
              title={`WAIT${w.label ? ` · ${w.label}` : ""} — playback pauses here until GO`}
              style={{
                position: "absolute",
                top: RULER_H,
                bottom: 0,
                left: GUTTER + w.offsetMs * pxPerMs,
                width: sel ? 3 : 2,
                background: sel ? "var(--amber)" : "#ff9f0a",
                cursor: "pointer",
                zIndex: 2,
              }}
            >
              <span
                className="font-mono"
                style={{
                  position: "absolute",
                  top: 2,
                  left: 3,
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "#ff9f0a",
                  background: "var(--bg)",
                  padding: "0 2px",
                  whiteSpace: "nowrap",
                }}
              >
                WAIT
              </span>
            </div>
          );
        })}

        {/* ── Playhead ── */}
        {/* Grab strip: a wide invisible hit zone over the line so the green
            bar can be dragged anywhere down its length (not just the 26px
            ruler). */}
        <div
          onPointerDown={onPlayheadPointerDown}
          title="Drag to scrub"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: playheadX - 6,
            width: 13,
            cursor: "ew-resize",
            zIndex: 4,
            touchAction: "none",
          }}
        />
        {/* Visual line + handle (no pointer events — the strip handles drag). */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: playheadX,
            width: 2,
            background: "var(--pvw)",
            zIndex: 4,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: -5,
              width: 12,
              height: 9,
              background: "var(--pvw)",
              clipPath: "polygon(0 0, 100% 0, 50% 100%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
