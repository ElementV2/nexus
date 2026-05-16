"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import type { VmixReplay, VmixInput } from "@/lib/vmix/types";
import {
  replayPlayPause,
  replayPlayForward,
  replayPlayBackward,
  replayFastForward,
  replayFastBackward,
  replayJumpToNow,
  replayJumpFrames,
  replaySetSpeed,
  setPosition,
} from "@/lib/vmix/commands";
import { ButtonGroup, Cell, Eyebrow, NumberPad } from "@/components/sw";

function formatReplayTC(isoStr: string): string {
  if (!isoStr) return "--:--:--";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${h}:${m}:${s}.${ms}`;
  } catch {
    return isoStr;
  }
}

function formatMs(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function InterpolatedTC({
  isoStr,
  playing,
  speed,
  className,
}: {
  isoStr: string;
  playing: boolean;
  speed: number;
  className?: string;
}) {
  const baseRef = useRef({ epoch: 0, wallTime: 0 });
  const spanRef = useRef<HTMLSpanElement | null>(null);
  // Keep latest speed in a ref so the rAF loop reads it without
  // restarting on each prop change. Updated inside an effect — React
  // 19 forbids ref mutation during render.
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const d = new Date(isoStr);
    if (!isNaN(d.getTime())) {
      baseRef.current = { epoch: d.getTime(), wallTime: performance.now() };
    }
  }, [isoStr]);

  useEffect(() => {
    if (!playing) return;
    // Write the interpolated TC directly into the DOM via the span ref
    // instead of `setState`. Three instances of this component run on
    // the Replay page (replay TC + A TC + B TC); the previous
    // setState-at-60-Hz pattern produced ~180 React commits/s during
    // playback, dragging the whole transport UI into a re-render storm.
    let raf: number;
    const tick = () => {
      const elapsed = performance.now() - baseRef.current.wallTime;
      const interp = baseRef.current.epoch + elapsed * speedRef.current;
      const d = new Date(interp);
      const h = String(d.getHours()).padStart(2, "0");
      const m = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      const ms = String(d.getMilliseconds()).padStart(3, "0");
      if (spanRef.current) {
        spanRef.current.textContent = `${h}:${m}:${s}.${ms}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, isoStr]);

  // Static label when not playing. Once playing flips on, the rAF
  // loop above takes over the textContent of the same span — React
  // doesn't re-render this component while playing.
  return (
    <span ref={spanRef} className={className}>
      {formatReplayTC(isoStr)}
    </span>
  );
}

const SPEED_PRESETS = [0.1, 0.25, 0.5, 0.75, 1.0];
const JUMP_PRESETS = [-300, -60, -30, -10, -1, 1, 10, 30, 60, 300];

interface ReplayTransportProps {
  replay: VmixReplay;
  replayInput?: VmixInput;
}

export function ReplayTransport({ replay, replayInput }: ReplayTransportProps) {
  const send = useVmixCommand();
  const [speed, setSpeed] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [localPos, setLocalPos] = useState(0);
  const throttleRef = useRef<number>(0);

  const isPlaying = replayInput?.state === "Running";
  const position = dragging ? localPos : replayInput?.position ?? 0;
  const duration = replayInput?.duration ?? 0;

  const handleSpeedChange = (val: number) => {
    setSpeed(val);
    send(replaySetSpeed(val));
  };

  const handleSeek = useCallback(
    (ms: number) => {
      setLocalPos(ms);
      const now = Date.now();
      if (now - throttleRef.current < 100) return;
      throttleRef.current = now;
      if (replayInput) send(setPosition(replayInput.number, ms));
    },
    [send, replayInput]
  );

  const handleSeekEnd = useCallback(
    (ms: number) => {
      setDragging(false);
      if (replayInput) send(setPosition(replayInput.number, ms));
    },
    [send, replayInput]
  );

  return (
    <div className="space-y-5">
      {/* Timeline */}
      {replayInput && duration > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between font-mono">
            <InterpolatedTC
              isoStr={replay.timecode}
              playing={isPlaying}
              speed={replay.speed}
              className="text-[11px] text-sw-text-dim"
            />
            <span className="text-[10px] text-sw-muted">{formatMs(duration)}</span>
          </div>
          <div className="relative" style={{ height: 28 }}>
            {/* Track */}
            <div
              className="absolute left-0 right-0"
              style={{
                top: 11,
                height: 6,
                background: "var(--card)",
                border: "1px solid var(--line-hi)",
                overflow: "hidden",
              }}
            >
              <div
                className="h-full"
                style={{
                  width: `${(position / duration) * 100}%`,
                  background: "var(--pgm)",
                  opacity: 0.85,
                }}
              />
            </div>
            {/* Playhead cap — same broadcast handle as the audio faders */}
            <div
              className="absolute flex items-center justify-center"
              style={{
                left: `${(position / duration) * 100}%`,
                top: 7,
                width: 14,
                height: 14,
                marginLeft: -7,
                gap: 2,
                background: "var(--ink)",
                border: "1px solid var(--bg)",
                pointerEvents: "none",
              }}
            >
              <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
              <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
              <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
            </div>
            <input
              type="range"
              min={0}
              max={duration}
              step={100}
              value={position}
              onPointerDown={() => {
                setDragging(true);
                setLocalPos(position);
              }}
              onChange={(e) => handleSeek(parseInt(e.target.value))}
              onPointerUp={(e) =>
                handleSeekEnd(parseInt((e.target as HTMLInputElement).value))
              }
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Transport buttons */}
      <ButtonGroup>
        <Cell
          onClick={() => send(replayFastBackward(10))}
          className="flex-1 h-[40px] text-[16px]"
          aria-label="Fast backward 10 seconds"
        >
          «
        </Cell>
        <Cell
          onClick={() => send(replayPlayBackward())}
          className="flex-1 h-[40px] text-[16px]"
          aria-label="Play backward"
        >
          ◀
        </Cell>
        <Cell
          active
          role={isPlaying ? "amber" : "green"}
          onClick={() => send(replayPlayPause())}
          className="flex-1 h-[40px] text-[18px]"
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
          aria-pressed={isPlaying}
        >
          {isPlaying ? "⏸" : "▶"}
        </Cell>
        <Cell
          onClick={() => send(replayPlayForward())}
          className="flex-1 h-[40px] text-[16px]"
          aria-label="Play forward"
        >
          ▶
        </Cell>
        <Cell
          onClick={() => send(replayFastForward(10))}
          className="flex-1 h-[40px] text-[16px]"
          aria-label="Fast forward 10 seconds"
        >
          »
        </Cell>
      </ButtonGroup>

      <Cell
        onClick={() => send(replayJumpToNow())}
        className="w-full h-[36px] text-[12px]"
      >
        ◐ Now
      </Cell>

      {/* Speed */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Eyebrow tone="muted">Speed</Eyebrow>
          <span className="font-mono text-[18px] font-bold text-sw-text">
            {speed.toFixed(2)}<span className="text-sw-muted text-[12px] ml-1">x</span>
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={speed}
          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
          className="w-full"
          style={{ accentColor: "var(--pgm)" }}
        />
        <ButtonGroup>
          {SPEED_PRESETS.map((v) => (
            <Cell
              key={v}
              active={Math.abs(speed - v) < 0.01}
              role="red"
              onClick={() => handleSpeedChange(v)}
              className="flex-1"
            >
              {v}×
            </Cell>
          ))}
        </ButtonGroup>
      </div>

      {/* Jump frames */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Jump · Frames</Eyebrow>
        <NumberPad
          values={JUMP_PRESETS.map((f) => (f > 0 ? `+${f}` : `${f}`))}
          cols={5}
          onSelect={(v) => {
            const n = parseInt(String(v), 10);
            send(replayJumpFrames(n));
          }}
        />
      </div>

      {/* Timecode */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Timecode</Eyebrow>
        <div className="border-[1px] border-sw-line-2 px-3 py-2 font-mono text-[13px] text-sw-text">
          <InterpolatedTC
            isoStr={replay.timecode}
            playing={isPlaying}
            speed={replay.speed}
          />
        </div>
        <div className="grid grid-cols-2 pr-px pb-px">
          <TCBlock
            label="A · TC"
            tone="red"
            iso={replay.timecodeA}
            playing={isPlaying}
            speed={replay.speedA}
          />
          <TCBlock
            label="B · TC"
            tone="blue"
            iso={replay.timecodeB}
            playing={isPlaying}
            speed={replay.speedB}
          />
        </div>
      </div>
    </div>
  );
}

function TCBlock({
  label,
  tone,
  iso,
  playing,
  speed,
}: {
  label: string;
  tone: "red" | "blue";
  iso: string;
  playing: boolean;
  speed: number;
}) {
  const colorClass = tone === "red" ? "text-sw-red" : "text-sw-blue";
  return (
    <div className="border-[1px] border-sw-line-2 -mr-px -mb-px px-3 py-2">
      <div className={cn("text-[9px] font-bold uppercase tracking-[0.16em] mb-1", colorClass)}>
        {label}
      </div>
      <InterpolatedTC
        isoStr={iso}
        playing={playing}
        speed={speed}
        className="font-mono text-[12px] text-sw-text-dim"
      />
      <div className="font-mono text-[9px] text-sw-sub mt-1">
        {speed.toFixed(2)}×
      </div>
    </div>
  );
}
