"use client";

import type { ReactNode } from "react";
import { Pause, Play, Square, SkipForward, FastForward, Flag } from "lucide-react";
import type { TransportSnapshot } from "./types";
import { fmtTime } from "./types";

type State = TransportSnapshot["state"];

export function TransportBar({
  leading,
  state,
  playheadMs,
  durationMs,
  skipWaits,
  onPlay,
  onPause,
  onResume,
  onStop,
  onGo,
  onToggleSkip,
  onAddWait,
}: {
  /** Scenario selector — sits with the transport controls. */
  leading?: ReactNode;
  state: State;
  playheadMs: number;
  durationMs: number;
  skipWaits: boolean;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onGo: () => void;
  onToggleSkip: () => void;
  onAddWait: () => void;
}) {
  const playing = state === "playing";
  const waiting = state === "waiting";
  const paused = state === "paused";

  return (
    <div
      className="flex items-center gap-2 sw-hairline-bottom flex-wrap"
      style={{
        padding: "8px 12px",
        background: "var(--panel)",
        flexShrink: 0,
      }}
    >
      {leading && (
        <>
          {leading}
          <div style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
        </>
      )}

      {/* Play / Pause */}
      {playing ? (
        <TBtn label="Pause" onClick={onPause} icon={<Pause size={14} />} />
      ) : (
        <TBtn
          label="Play"
          accent
          onClick={paused ? onResume : onPlay}
          icon={<Play size={14} />}
        />
      )}

      <TBtn label="Stop" onClick={onStop} icon={<Square size={13} />} />

      <TBtn
        label="GO"
        accent={waiting}
        disabled={!waiting}
        onClick={onGo}
        icon={<SkipForward size={14} />}
      />

      {/* Skip-waits toggle */}
      <TBtn
        label="Skip waits"
        active={skipWaits}
        onClick={onToggleSkip}
        icon={<FastForward size={13} />}
      />

      <div style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />

      <TBtn label="Add wait" onClick={onAddWait} icon={<Flag size={13} />} />

      {/* Push the readout to the right (scrub by dragging the playhead). */}
      <div style={{ flex: 1, minWidth: 8 }} />

      {/* Readout */}
      <span
        className="font-mono"
        style={{
          fontSize: 12,
          color: waiting ? "#ff9f0a" : "var(--ink)",
          fontWeight: 700,
          whiteSpace: "nowrap",
          minWidth: 96,
          textAlign: "right",
        }}
      >
        {fmtTime(playheadMs)} / {fmtTime(durationMs)}
      </span>

      <StateBadge state={state} />
    </div>
  );
}

function TBtn({
  label,
  icon,
  onClick,
  accent,
  active,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 font-mono uppercase"
      style={{
        padding: "5px 9px",
        fontSize: 9,
        letterSpacing: "0.1em",
        fontWeight: 700,
        background: accent
          ? "var(--amber)"
          : active
            ? "var(--amber-tint)"
            : "var(--panel-2)",
        color: accent
          ? "var(--bg)"
          : active
            ? "var(--amber)"
            : "var(--mid)",
        border: `1px solid ${accent || active ? "var(--amber)" : "var(--line-hi)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function StateBadge({ state }: { state: State }) {
  const map: Record<State, { text: string; color: string }> = {
    idle: { text: "Idle", color: "var(--sub)" },
    playing: { text: "Playing", color: "var(--pvw)" },
    waiting: { text: "Waiting", color: "#ff9f0a" },
    paused: { text: "Paused", color: "var(--mid)" },
  };
  const s = map[state];
  return (
    <span
      className="font-mono uppercase"
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.12em",
        color: s.color,
        minWidth: 56,
        textAlign: "right",
      }}
    >
      {s.text}
    </span>
  );
}
