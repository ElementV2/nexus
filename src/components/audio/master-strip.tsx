"use client";

import { memo, useCallback } from "react";
import { FaderStrip } from "@/components/sw/FaderStrip";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { useAudioFader } from "@/hooks/use-audio-fader";
import {
  setMasterVolume,
  masterAudioOn,
  masterAudioOff,
} from "@/lib/vmix/commands";
import { formatDb, getGainColor, meterToLevel } from "@/lib/utils/audio";
import type { VmixAudioMaster } from "@/lib/vmix/types";

interface MasterStripProps {
  audio: VmixAudioMaster;
}

function MasterStripImpl({ audio }: MasterStripProps) {
  const send = useVmixCommand();

  const sendVolume = useCallback(
    (pos: number) => send(setMasterVolume(pos)),
    [send]
  );
  const { displaySlider, db, onChange, onChangeStart, onChangeEnd } =
    useAudioFader({ volume: audio.volume, send: sendVolume });

  const handleMuteToggle = () => {
    send(audio.muted ? masterAudioOn() : masterAudioOff());
  };

  const peakMeter = meterToLevel(Math.max(audio.meterF1, audio.meterF2));
  const gainColor = getGainColor(db);

  return (
    <div
      className="flex flex-col shrink-0"
      style={{
        width: 116,
        padding: "12px 10px",
        gap: 10,
        background: "var(--panel-2)",
        borderLeft: "2px solid var(--amber)",
        borderRight: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Header */}
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span
          className="font-mono uppercase"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "1.6px",
            color: "var(--amber)",
          }}
        >
          MASTER
        </span>
        <span
          className="truncate"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          Output
        </span>
      </div>

      {/* Fader */}
      <div className="mx-auto">
        <FaderStrip
          level={displaySlider / 100}
          meter={peakMeter}
          muted={audio.muted}
          height={240}
          onChange={onChange}
          onChangeStart={onChangeStart}
          onChangeEnd={onChangeEnd}
        />
      </div>

      {/* GAIN */}
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
        data-role={audio.muted ? "red" : "default"}
        className="sw-cell"
        style={{ width: "100%", minHeight: 30, fontSize: 10 }}
        aria-pressed={audio.muted}
        aria-label="Mute master bus"
      >
        ● {audio.muted ? "Muted" : "Live"}
      </button>
    </div>
  );
}

// Custom equality — see AudioStrip for the rationale.
export const MasterStrip = memo(MasterStripImpl, (prev, next) => {
  const a = prev.audio;
  const b = next.audio;
  return (
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.meterF1 === b.meterF1 &&
    a.meterF2 === b.meterF2
  );
});
