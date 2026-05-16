"use client";

import { memo, useEffect, useRef } from "react";
import type { AbletonClipSlot } from "@/lib/ableton/types";
import type { ClipPositionSample } from "@/stores/ableton-store";

interface ClipCellProps {
  slot: AbletonClipSlot;
  /** Track index — passed so the parent can use a single stable onFire
   *  callback regardless of how many cells render. */
  trackIndex: number;
  /** Scene index — same rationale as trackIndex. */
  sceneIndex: number;
  isPlaying: boolean;
  /**
   * Optimistic "queued / triggered" state. Set the moment the user
   * clicks; cleared by the store when a playing-slot push arrives, or
   * by the page's safety timeout. Mirrors Ableton's blinking-play cue
   * for clips that are waiting on a launch-quantize boundary.
   */
  isPending?: boolean;
  /** Stable callback. The cell forwards its (track, scene) coordinates
   *  internally so the parent's onFire prop reference doesn't have to
   *  churn per-cell — keeps React.memo bailable. */
  onFire: (trackIndex: number, sceneIndex: number) => void;
  /** Latest server sample for this track's playing clip, if any. */
  positionSample?: ClipPositionSample;
  /** Live tempo, used to interpolate forward between samples. */
  tempo: number;
}

/** Ableton encodes clip colors as 24-bit ints. */
function intToHex(color: number): string {
  const hex = (color >>> 0).toString(16).padStart(6, "0").slice(-6);
  return `#${hex}`;
}

/**
 * Compute a foreground color that stays readable against the clip's
 * Ableton color. Uses BT.709 luminance to pick black vs. ink.
 */
function readableFg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#101010" : "#f5f5f5";
}

/**
 * Animated progress bar for the currently-playing clip. Driven directly
 * from a rAF loop into `transform: scaleX(...)` so the cell itself never
 * re-renders on the tick — keeps the grid fluid even at 30+ playing
 * clips.
 */
function PlayingBar({
  fg,
  sample,
  length,
  tempo,
}: {
  fg: string;
  sample: ClipPositionSample;
  length: number;
  tempo: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Stash inputs in refs so the rAF loop reads the latest values
  // without restarting on every position push (AbletonOSC fires
  // ~30 Hz while playing; tearing down rAF that often allocates a
  // fresh closure every frame batch). Refs are mutated inside an
  // effect, never during render — React 19 forbids the latter.
  const sampleRef = useRef(sample);
  const lengthRef = useRef(length);
  const tempoRef = useRef(tempo);
  useEffect(() => {
    sampleRef.current = sample;
    lengthRef.current = length;
    tempoRef.current = tempo;
  }, [sample, length, tempo]);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    el.style.transformOrigin = "left center";

    let raf = 0;
    const tick = () => {
      const s = sampleRef.current;
      const len = lengthRef.current;
      const t = tempoRef.current;
      if (len > 0) {
        const elapsedMs = Date.now() - s.ts;
        // Negative if the sample is in the future (clock skew) — clamp.
        const advanced = Math.max(0, (elapsedMs * t) / 60000);
        const beat = (s.position + advanced) % len;
        const ratio = Math.max(0, Math.min(1, beat / len));
        el.style.transform = `scaleX(${ratio})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Run once per mount — the loop reads refs, so new samples /
    // tempo / length flow in without needing the effect to restart.
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 3,
        background: "rgba(0,0,0,0.25)",
        overflow: "hidden",
      }}
    >
      <div
        ref={ref}
        style={{
          width: "100%",
          height: "100%",
          background: fg,
          opacity: 0.85,
          transform: "scaleX(0)",
          transformOrigin: "left center",
        }}
      />
    </div>
  );
}

function ClipCellImpl({
  slot,
  trackIndex,
  sceneIndex,
  isPlaying,
  isPending,
  onFire,
  positionSample,
  tempo,
}: ClipCellProps) {
  // Once Ableton confirms the clip is playing, the pending cue is
  // redundant — give precedence to "playing" so the play icon stops
  // blinking the moment the clip actually starts.
  const showPending = !!isPending && !isPlaying;
  if (!slot.hasClip || !slot.clip) {
    return (
      <button
        disabled
        className="sw-cell"
        style={{
          minHeight: 56,
          background: "var(--bg)",
          border: "1px solid var(--line)",
          cursor: "default",
          opacity: 0.5,
        }}
        aria-label="Empty slot"
      />
    );
  }

  const bg = intToHex(slot.clip.color);
  const fg = readableFg(bg);
  const label = slot.clip.name || "Clip";
  const showProgress =
    isPlaying &&
    positionSample &&
    slot.clip.length > 0 &&
    positionSample.clipIndex !== undefined;

  return (
    <button
      onClick={() => onFire(trackIndex, sceneIndex)}
      className="relative transition-transform"
      style={{
        minHeight: 56,
        background: bg,
        color: fg,
        // Keep the 1px border on every cell so the grid alignment
        // never shifts; the "playing" / "pending" emphasis is
        // rendered as a 2px outline that lives outside the box-model
        // and doesn't push neighbours around.
        border: "1px solid rgba(0,0,0,0.4)",
        outline: isPlaying
          ? "2px solid var(--ink)"
          : showPending
            ? "2px solid var(--amber)"
            : "none",
        outlineOffset: isPlaying || showPending ? -2 : 0,
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 4,
        transitionDuration: "80ms",
        overflow: "hidden",
      }}
      title={`Fire: ${label}`}
      aria-label={
        isPlaying ? `Stop ${label} (currently playing)` : `Fire ${label}`
      }
      aria-pressed={isPlaying}
    >
      <span
        className="font-mono uppercase truncate w-full text-left"
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "1px",
          opacity: 0.85,
        }}
      >
        {label}
      </span>
      {isPlaying && (
        <span
          className="font-mono"
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: fg,
          }}
        >
          ▶ PLAY
        </span>
      )}
      {showPending && (
        <span
          className="font-mono ableton-pending-blink"
          style={{
            position: "absolute",
            top: 4,
            right: 6,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: fg,
          }}
        >
          ▶ CUE
        </span>
      )}
      {showProgress && positionSample && (
        <PlayingBar
          fg={fg}
          sample={positionSample}
          length={slot.clip.length}
          tempo={tempo}
        />
      )}
    </button>
  );
}

// Custom equality so the grid doesn't burst-re-render on every
// `playing_position` push (~30 Hz). We ignore `positionSample` ref
// changes when the cell isn't actively playing this clip — the
// progress bar inside `<PlayingBar>` reads the latest sample via a
// ref, so a fresh sample ref doesn't require a host re-render.
export const ClipCell = memo(ClipCellImpl, (prev, next) => {
  if (prev.trackIndex !== next.trackIndex) return false;
  if (prev.sceneIndex !== next.sceneIndex) return false;
  if (prev.isPlaying !== next.isPlaying) return false;
  if (!!prev.isPending !== !!next.isPending) return false;
  if (prev.onFire !== next.onFire) return false;
  // Tempo flips infrequently. When it changes during playback the
  // PlayingBar's tempoRef takes over via its own effect, so we only
  // re-render the host if this cell is actually showing the bar.
  if (next.isPlaying && prev.tempo !== next.tempo) return false;
  // Slot identity — same shallow strategy as InputCell on the Live
  // page.
  if (prev.slot !== next.slot) {
    if (prev.slot.hasClip !== next.slot.hasClip) return false;
    if (prev.slot.clip?.name !== next.slot.clip?.name) return false;
    if (prev.slot.clip?.color !== next.slot.clip?.color) return false;
    if (prev.slot.clip?.length !== next.slot.clip?.length) return false;
  }
  // `positionSample`: when the cell isn't playing the field is
  // undefined either way. When it IS playing, a fresh sample ref
  // arrives from the broker — the PlayingBar effect below catches
  // those via deps and updates `sampleRef`. We MUST re-render so
  // that effect fires; the cell render itself is cheap.
  //
  // Critical: when a position push for a different track replaces
  // the parent's `positions` Map, the other tracks' Map entries keep
  // their previous sample reference (Map.set leaves the rest by ref).
  // So this reference compare only fails for the actually-affected
  // cell, not for every cell in the grid.
  if (next.isPlaying && prev.positionSample !== next.positionSample) {
    return false;
  }
  return true;
});
