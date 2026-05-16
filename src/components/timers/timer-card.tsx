"use client";

import { memo, useState } from "react";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import {
  setCountdown,
  startCountdown,
  pauseCountdown,
  stopCountdown,
} from "@/lib/vmix/commands";
import { Play, Pause, Square, Clock, Check } from "lucide-react";
import type { VmixInput } from "@/lib/vmix/types";
import { MonoInput, SetButton } from "@/components/sw";

interface TimerCardProps {
  input: VmixInput;
}

function TimerCardImpl({ input }: TimerCardProps) {
  const send = useVmixCommand();
  const [timeInput, setTimeInput] = useState("00:05:00");

  const isRunning = input.state === "Running";
  const isPaused = input.state === "Paused";

  const stateTone = isRunning ? "pvw" : isPaused ? "amber" : "muted";
  const statePillFg =
    stateTone === "pvw"
      ? "var(--pvw)"
      : stateTone === "amber"
        ? "var(--amber)"
        : "var(--muted)";
  const statePillBg =
    stateTone === "pvw"
      ? "var(--pvw-tint)"
      : stateTone === "amber"
        ? "var(--amber-tint)"
        : "var(--card)";

  return (
    <div
      style={{
        padding: 12,
        background: "var(--card)",
        border: "1px solid var(--line)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 28,
            height: 28,
            border: `1px solid ${isRunning ? "var(--amber)" : "var(--line-hi)"}`,
            color: isRunning ? "var(--amber)" : "var(--muted)",
          }}
        >
          <Clock size={14} strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="truncate"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
          >
            {input.title}
          </div>
          <div className="label" style={{ fontSize: 9 }}>
            {input.type}
          </div>
        </div>
        <span
          className="font-mono uppercase shrink-0"
          style={{
            padding: "2px 8px",
            fontSize: 9,
            letterSpacing: "1.4px",
            fontWeight: 700,
            background: statePillBg,
            color: statePillFg,
            border: `1px solid ${statePillFg}`,
          }}
        >
          {input.state || "Idle"}
        </span>
      </div>

      {/* Time display */}
      <div className="text-center" style={{ padding: "16px 0" }}>
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "-1px",
            color: isRunning ? "var(--ink)" : "var(--mid)",
          }}
        >
          {input.title}
        </span>
      </div>

      {/* Set time — uses the shared MonoInput + SetButton primitives so
          the input/button collés-pair matches the look used in Titles. */}
      <div className="flex" style={{ marginBottom: 8 }}>
        <MonoInput
          value={timeInput}
          onChange={(e) => setTimeInput(e.target.value)}
          placeholder="HH:MM:SS"
          className="tabular-nums text-center"
          style={{ flex: 1 }}
          aria-label="Countdown duration"
        />
        <SetButton
          onClick={() => send(setCountdown(input.number, timeInput))}
          aria-label="Set countdown"
          title="Set time"
        >
          <Check size={14} strokeWidth={1.5} />
        </SetButton>
      </div>

      {/* Controls — collés bar */}
      <div className="inline-flex w-full">
        <TimerControl
          onClick={() => send(startCountdown(input.number))}
          tone="pvw"
          position="first"
        >
          <Play size={11} strokeWidth={1.8} /> Start
        </TimerControl>
        <TimerControl
          onClick={() => send(pauseCountdown(input.number))}
          tone="amber"
        >
          <Pause size={11} strokeWidth={1.8} /> Pause
        </TimerControl>
        <TimerControl
          onClick={() => send(stopCountdown(input.number))}
          tone="pgm"
          position="last"
        >
          <Square size={11} strokeWidth={1.8} /> Stop
        </TimerControl>
      </div>
    </div>
  );
}

export const TimerCard = memo(TimerCardImpl);

function TimerControl({
  children,
  onClick,
  tone,
  position,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: "pvw" | "amber" | "pgm";
  position?: "first" | "last";
}) {
  const fg =
    tone === "pvw"
      ? "var(--pvw)"
      : tone === "amber"
        ? "var(--amber)"
        : "var(--pgm)";
  const tint =
    tone === "pvw"
      ? "var(--pvw-tint)"
      : tone === "amber"
        ? "var(--amber-tint)"
        : "var(--pgm-tint)";
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center font-mono uppercase transition-colors"
      style={{
        flex: 1,
        gap: 4,
        height: 28,
        fontSize: 10,
        letterSpacing: "1.4px",
        fontWeight: 600,
        background: tint,
        color: fg,
        border: `1px solid ${fg}`,
        marginLeft: position === "first" ? 0 : -1,
        position: "relative",
        zIndex: 1,
        transitionDuration: "80ms",
      }}
    >
      {children}
    </button>
  );
}
