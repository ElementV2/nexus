"use client";

import { cn } from "@/lib/utils";

interface StatusDotProps {
  connected: boolean;
  connecting?: boolean;
  className?: string;
}

/**
 * Tiny state indicator. Tactical Refined: a 6px square (the global
 * reset zeroes border-radius, so this reads as a small filled chip),
 * tinted via signal tokens. Animations capped at 80ms.
 */
export function StatusDot({ connected, connecting, className }: StatusDotProps) {
  const bg = connected
    ? "var(--pvw)"
    : connecting
      ? "var(--amber)"
      : "var(--sub)";
  return (
    <span
      aria-label={
        connected ? "connected" : connecting ? "connecting" : "offline"
      }
      className={cn("inline-block", connecting && "animate-pulse", className)}
      style={{
        width: 6,
        height: 6,
        background: bg,
      }}
    />
  );
}
