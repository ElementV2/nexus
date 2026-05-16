"use client";

import { useVmixCommand } from "@/hooks/use-vmix-command";
import { play, pause, restart, toggleLoop } from "@/lib/vmix/commands";
import { Play, Pause, RotateCcw, Repeat } from "lucide-react";
import type { VmixInput } from "@/lib/vmix/types";

interface TransportControlsProps {
  input: VmixInput;
}

/**
 * Transport controls — restart / play-pause / loop.
 * Tactical Refined: rectangular icon buttons in a collés bar.
 * Active states use signal-color tinted background, no scale animations.
 */
export function TransportControls({ input }: TransportControlsProps) {
  const send = useVmixCommand();

  const isPlaying = input.state === "Running";
  const isPaused = input.state === "Paused";

  return (
    <div className="inline-flex">
      <TransportButton
        title="Restart"
        onClick={() => send(restart(input.number))}
        position="first"
      >
        <RotateCcw size={14} strokeWidth={1.6} />
      </TransportButton>

      {isPlaying ? (
        <TransportButton
          title="Pause"
          onClick={() => send(pause(input.number))}
          tone="amber"
          active
        >
          <Pause size={14} strokeWidth={1.6} />
        </TransportButton>
      ) : (
        <TransportButton
          title="Play"
          onClick={() => send(play(input.number))}
          tone="pvw"
          active={isPaused}
        >
          <Play size={14} strokeWidth={1.6} />
        </TransportButton>
      )}

      <TransportButton
        title="Loop"
        onClick={() => send(toggleLoop(input.number))}
        tone="cyan"
        active={input.loop}
        position="last"
      >
        <Repeat size={14} strokeWidth={1.6} />
      </TransportButton>
    </div>
  );
}

function TransportButton({
  children,
  onClick,
  title,
  tone,
  active = false,
  position,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  tone?: "pvw" | "amber" | "cyan";
  active?: boolean;
  position?: "first" | "last";
}) {
  const fg =
    tone === "amber"
      ? "var(--amber)"
      : tone === "cyan"
        ? "var(--cyan)"
        : tone === "pvw"
          ? "var(--pvw)"
          : "var(--ink)";
  const tint =
    tone === "amber"
      ? "var(--amber-tint)"
      : tone === "cyan"
        ? "var(--cyan-tint)"
        : tone === "pvw"
          ? "var(--pvw-tint)"
          : "var(--card-hi)";

  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      className="relative flex items-center justify-center transition-colors"
      style={{
        width: 28,
        height: 28,
        background: active ? tint : "var(--card)",
        color: active ? fg : "var(--mid)",
        borderTop: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
        borderRight: "1px solid var(--line)",
        borderLeft: position === "first" ? "1px solid var(--line)" : "none",
        transitionDuration: "80ms",
      }}
    >
      {active && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: fg,
          }}
        />
      )}
      {children}
    </button>
  );
}
