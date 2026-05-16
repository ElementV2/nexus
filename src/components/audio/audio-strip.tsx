"use client";

import { memo, useCallback } from "react";
import { FaderStrip } from "@/components/sw/FaderStrip";
import { BusButton } from "./bus-button";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { useAudioFader } from "@/hooks/use-audio-fader";
import {
  setVolume,
  audioOn,
  audioOff,
  audioBusOn,
  audioBusOff,
} from "@/lib/vmix/commands";
import { formatDb, getGainColor, meterToLevel } from "@/lib/utils/audio";
import type { VmixInput } from "@/lib/vmix/types";
import { AUDIO_BUS_SENDS, type AudioBus } from "@/lib/vmix/constants";

interface AudioStripProps {
  input: VmixInput;
  index: number;
  availableBuses: string[];
}

function AudioStripImpl({ input, index, availableBuses }: AudioStripProps) {
  const send = useVmixCommand();

  const sendVolume = useCallback(
    (pos: number) => send(setVolume(input.number, pos)),
    [send, input.number]
  );
  const { displaySlider, db, onChange, onChangeStart, onChangeEnd } =
    useAudioFader({ volume: input.volume, send: sendVolume });

  const activeBusses = input.audioBusses.split(",").filter(Boolean);

  const handleMuteToggle = () => {
    send(input.muted ? audioOn(input.number) : audioOff(input.number));
  };

  const handleBusToggle = (bus: string) => {
    const isActive = activeBusses.includes(bus);
    send(
      isActive ? audioBusOff(input.number, bus) : audioBusOn(input.number, bus)
    );
  };

  const peakMeter = meterToLevel(Math.max(input.meterF1, input.meterF2));

  // M (master) + every bus actually present in this vMix session.
  const busList: AudioBus[] = [
    "M",
    ...AUDIO_BUS_SENDS.filter((b) =>
      availableBuses.includes(b)
    ),
  ];

  const gainColor = getGainColor(db);

  return (
    <div
      className="flex flex-col shrink-0"
      style={{
        width: 116,
        padding: "12px 10px",
        gap: 10,
        borderRight: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
        background: "var(--panel)",
      }}
    >
      {/* Header: index + name */}
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: 9,
            color: "var(--muted)",
            letterSpacing: "0.12em",
          }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span
          className="truncate"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--ink)",
          }}
          title={input.title}
        >
          {input.shortTitle || input.title}
        </span>
      </div>

      {/* Fader + meter + tick labels */}
      <div className="mx-auto">
        <FaderStrip
          level={displaySlider / 100}
          meter={peakMeter}
          muted={input.muted}
          height={240}
          onChange={onChange}
          onChangeStart={onChangeStart}
          onChangeEnd={onChangeEnd}
        />
      </div>

      {/* GAIN display */}
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

      {/* Mute */}
      <button
        onClick={handleMuteToggle}
        data-active="true"
        data-role={input.muted ? "red" : "default"}
        className="sw-cell"
        style={{ width: "100%", minHeight: 30, fontSize: 10 }}
        aria-pressed={input.muted}
        aria-label={`Mute ${input.shortTitle || input.title}`}
      >
        ● {input.muted ? "Muted" : "Live"}
      </button>

      {/* Bus grid — 2 columns */}
      <div className="grid grid-cols-2">
        {busList.map((bus) => (
          <BusButton
            key={bus}
            bus={bus}
            active={activeBusses.includes(bus)}
            onToggle={() => handleBusToggle(bus)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Memoised so we don't re-render every audio strip on every poll tick
 * just because the parent (AudioPage) re-rendered. The upstream
 * `vmixState` is replaced on each tick, so the input ref always
 * changes — the default React.memo shallow compare would defeat
 * itself. The predicate below compares only the fields that actually
 * drive the rendered strip; pure index/array re-allocs are ignored.
 */
export const AudioStrip = memo(AudioStripImpl, (prev, next) => {
  if (prev.index !== next.index) return false;
  if (prev.availableBuses !== next.availableBuses) return false;
  const a = prev.input;
  const b = next.input;
  return (
    a.number === b.number &&
    a.title === b.title &&
    a.shortTitle === b.shortTitle &&
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.meterF1 === b.meterF1 &&
    a.meterF2 === b.meterF2 &&
    a.audioBusses === b.audioBusses
  );
});
