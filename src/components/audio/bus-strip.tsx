"use client";

import { memo, useCallback } from "react";
import { FaderStrip } from "@/components/sw/FaderStrip";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { useAudioFader } from "@/hooks/use-audio-fader";
import {
  setBusVolume,
  busAudioOn,
  busAudioOff,
} from "@/lib/vmix/commands";
import { formatDb, getGainColor, meterToLevel } from "@/lib/utils/audio";
import type { VmixAudioBus } from "@/lib/vmix/types";

interface BusStripProps {
  bus: VmixAudioBus;
}

function BusStripImpl({ bus }: BusStripProps) {
  const send = useVmixCommand();

  const sendVolume = useCallback(
    (pos: number) => send(setBusVolume(bus.name, pos)),
    [send, bus.name]
  );
  const { displaySlider, db, onChange, onChangeStart, onChangeEnd } =
    useAudioFader({ volume: bus.volume, send: sendVolume });

  const handleMuteToggle = () => {
    send(bus.muted ? busAudioOn(bus.name) : busAudioOff(bus.name));
  };

  const peakMeter = meterToLevel(Math.max(bus.meterF1, bus.meterF2));
  const gainColor = getGainColor(db);

  return (
    <div
      className="flex flex-col shrink-0"
      style={{
        width: 116,
        padding: "12px 10px",
        gap: 10,
        background: "var(--panel)",
        borderRight: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Header */}
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span className="label" style={{ fontSize: 9 }}>
          Bus
        </span>
        <span
          className="truncate"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          Bus {bus.name}
        </span>
      </div>

      <div className="mx-auto">
        <FaderStrip
          level={displaySlider / 100}
          meter={peakMeter}
          muted={bus.muted}
          height={240}
          onChange={onChange}
          onChangeStart={onChangeStart}
          onChangeEnd={onChangeEnd}
        />
      </div>

      <div
        className="flex items-baseline justify-between"
        style={{
          padding: "4px 0",
          borderTop: "1px solid var(--line)",
        }}
      >
        <span className="label">Gain</span>
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: gainColor,
          }}
        >
          {formatDb(db)}
        </span>
      </div>

      <button
        onClick={handleMuteToggle}
        data-active="true"
        data-role={bus.muted ? "red" : "default"}
        className="sw-cell"
        style={{ width: "100%", minHeight: 30, fontSize: 10 }}
        aria-pressed={bus.muted}
        aria-label={`Mute bus ${bus.name}`}
      >
        ● {bus.muted ? "Muted" : "Live"}
      </button>
    </div>
  );
}

// Custom equality — see AudioStrip for the rationale. The bus snapshot
// ref changes every poll tick; we only re-render when a field that
// drives the rendered strip actually moved.
export const BusStrip = memo(BusStripImpl, (prev, next) => {
  const a = prev.bus;
  const b = next.bus;
  return (
    a.name === b.name &&
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.meterF1 === b.meterF1 &&
    a.meterF2 === b.meterF2
  );
});
