"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAbletonStore } from "@/stores/ableton-store";
import { MonoInput } from "@/components/sw";
import { sendAbletonCommand } from "@/lib/ableton/api";
import { Play, Square, SkipForward, Music, Activity } from "lucide-react";

/**
 * Top transport strip for the Ableton page. Shows live tempo, play/stop
 * controls, metronome toggle and an interpolated bars.beats counter.
 *
 * The position counter is driven by:
 *   1. periodic `current_song_time` server pushes (every ~1.5 s while
 *      playing, plus one per state change)
 *   2. local rAF interpolation using the last sample + tempo
 *
 * That gives sub-frame visual continuity even though the server only
 * resyncs at ~0.7 Hz.
 */

function formatBarsBeats(beat: number, sigNum: number): string {
  const safeSig = sigNum > 0 ? sigNum : 4;
  const bar = Math.floor(beat / safeSig) + 1;
  const beatInBar = Math.floor(beat % safeSig) + 1;
  // Beat fraction → 16th-note sub-position, broadcast-style readout.
  const frac = Math.floor(((beat % 1) * 4) % 4) + 1;
  return `${bar}.${beatInBar}.${frac}`;
}

/**
 * Self-contained bars.beats readout. Owns its own rAF loop and only
 * re-renders when the formatted label changes (~once per 16th note),
 * keeping `Date.now()` out of the parent's render path.
 */
function PositionReadout({
  songBeat,
  lastUpdateTs,
  tempo,
  sigNum,
  isPlaying,
}: {
  songBeat: number;
  lastUpdateTs: number;
  tempo: number;
  sigNum: number;
  isPlaying: boolean;
}) {
  const compute = useCallback(() => {
    const now = Date.now();
    const beat = isPlaying
      ? songBeat + ((now - lastUpdateTs) * tempo) / 60000
      : songBeat;
    return formatBarsBeats(Math.max(0, beat), sigNum);
  }, [songBeat, lastUpdateTs, tempo, sigNum, isPlaying]);

  const [label, setLabel] = useState(() => compute());

  // Recompute immediately when inputs change so the static (non-playing)
  // label updates without waiting for the rAF tick.
  useEffect(() => {
    setLabel(compute());
  }, [compute]);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= 33) {
        last = t;
        const next = compute();
        setLabel((cur) => (cur === next ? cur : next));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, compute]);

  return (
    <span
      className="font-mono tabular-nums"
      style={{
        fontSize: 18,
        fontWeight: 700,
        color: isPlaying ? "var(--pvw)" : "var(--ink)",
        minWidth: 88,
        textAlign: "right",
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  );
}

export function TransportBar() {
  const transport = useAbletonStore((s) => s.transport);
  const [tempoDraft, setTempoDraft] = useState("");
  const [tempoEditing, setTempoEditing] = useState(false);

  // Derive the displayed value — no useEffect mirror needed. While the
  // user is actively editing, the draft is canonical; otherwise we show
  // whatever the server last reported.
  const displayedTempo = tempoEditing
    ? tempoDraft
    : transport
      ? transport.tempo.toFixed(2)
      : "";

  const submitTempo = useCallback(() => {
    setTempoEditing(false);
    const v = parseFloat(tempoDraft);
    if (
      Number.isFinite(v) &&
      v > 0 &&
      v < 1000 &&
      transport &&
      v !== transport.tempo
    ) {
      sendAbletonCommand({ action: "set-tempo", bpm: v });
    }
    // No need to clear tempoDraft — the next render computes
    // displayedTempo from transport.tempo because tempoEditing is false.
  }, [tempoDraft, transport]);

  if (!transport) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
        padding: 8,
        gap: 8,
      }}
    >
      {/* Play / Stop / Continue */}
      <div style={{ display: "flex", gap: 4 }}>
        <TransportButton
          active={transport.isPlaying}
          onClick={() =>
            sendAbletonCommand({
              action: transport.isPlaying ? "stop" : "play",
            })
          }
          activeColor="var(--pvw)"
          title={transport.isPlaying ? "Stop" : "Play"}
        >
          {transport.isPlaying ? <Square size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
          {transport.isPlaying ? "Stop" : "Play"}
        </TransportButton>
        <TransportButton
          onClick={() => sendAbletonCommand({ action: "continue" })}
          title="Continue"
        >
          <SkipForward size={14} strokeWidth={1.5} />
          Cont.
        </TransportButton>
      </div>

      <Divider />

      {/* Tempo edit + tap */}
      <Group label="Tempo">
        <MonoInput
          value={displayedTempo}
          onChange={(e) => {
            setTempoEditing(true);
            setTempoDraft(e.target.value);
          }}
          onBlur={submitTempo}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setTempoEditing(false);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          className="tabular-nums"
          style={{
            width: 70,
            textAlign: "right",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--ink)",
          }}
          aria-label="Tempo (BPM)"
        />
        <button
          onClick={() => sendAbletonCommand({ action: "tap-tempo" })}
          className="font-mono uppercase transition-colors"
          style={{
            padding: "6px 12px",
            fontSize: 10,
            letterSpacing: "1.4px",
            background: "var(--card)",
            color: "var(--mid)",
            border: "1px solid var(--line-hi)",
            transitionDuration: "80ms",
          }}
          title="Tap tempo"
        >
          TAP
        </button>
      </Group>

      <Divider />

      {/* Metronome toggle */}
      <TransportButton
        active={transport.metronome}
        onClick={() =>
          sendAbletonCommand({
            action: "set-metronome",
            on: !transport.metronome,
          })
        }
        activeColor="var(--amber)"
        title={transport.metronome ? "Metronome on" : "Metronome off"}
      >
        <Music size={14} strokeWidth={1.5} />
        Click
      </TransportButton>

      <div style={{ flex: 1 }} />

      {/* Bars.beats readout */}
      <Group label="Position">
        <PositionReadout
          songBeat={transport.songBeat}
          lastUpdateTs={transport.lastUpdateTs}
          tempo={transport.tempo}
          sigNum={transport.sigNum}
          isPlaying={transport.isPlaying}
        />
        <Activity
          size={14}
          color={transport.isPlaying ? "var(--pvw)" : "var(--muted)"}
        />
      </Group>

      <Group label="Sig.">
        <span
          className="font-mono tabular-nums"
          style={{ fontSize: 13, color: "var(--mid)" }}
        >
          {transport.sigNum}/{transport.sigDen}
        </span>
      </Group>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        background: "var(--line)",
        margin: "0 4px",
      }}
      aria-hidden
    />
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
      }}
    >
      <span
        className="label"
        style={{ minWidth: 0 }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function TransportButton({
  children,
  onClick,
  active,
  activeColor = "var(--pvw)",
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  activeColor?: string;
  title?: string;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <button
      ref={ref}
      onClick={onClick}
      title={title}
      className="font-mono uppercase transition-colors inline-flex items-center"
      style={{
        gap: 6,
        padding: "8px 12px",
        fontSize: 10,
        letterSpacing: "1.4px",
        background: active ? "var(--panel-2)" : "var(--card)",
        color: active ? activeColor : "var(--ink)",
        border: `1px solid ${active ? activeColor : "var(--line-hi)"}`,
        transitionDuration: "80ms",
        minHeight: 32,
      }}
    >
      {children}
    </button>
  );
}
