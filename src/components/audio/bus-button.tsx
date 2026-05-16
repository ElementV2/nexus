"use client";

import { cn } from "@/lib/utils";
import type { AudioBus } from "@/lib/vmix/constants";

interface BusButtonProps {
  bus: AudioBus;
  active: boolean;
  onToggle: () => void;
}

export function BusButton({ bus, active, onToggle }: BusButtonProps) {
  return (
    <button
      onClick={onToggle}
      data-active={active ? "true" : "false"}
      data-role="green"
      className={cn("sw-cell w-full")}
      style={{ minHeight: 32, fontSize: 11 }}
      aria-pressed={active}
      aria-label={`Route to bus ${bus}`}
    >
      {bus}
    </button>
  );
}
