"use client";

import { useVmixStore } from "@/stores/vmix-store";
import { useShallow } from "zustand/react/shallow";
import { AudioStrip } from "@/components/audio/audio-strip";
import { BusStrip } from "@/components/audio/bus-strip";
import { MasterStrip } from "@/components/audio/master-strip";
import {
  TopBar,
  Section,
  ToolbarSlot,
} from "@/components/sw";
import { meterToDb, formatDb } from "@/lib/utils/audio";

export default function AudioPage() {
  const vmixState = useVmixStore((s) => s.vmixState);
  const connected = useVmixStore((s) => s.connected);

  // useShallow keeps the array reference stable as long as the input
  // identities (by number) are unchanged — so re-renders below only
  // fire when an input is actually added / removed / reordered, not
  // on every poll tick (which would force every AudioStrip's memo to
  // bail since its props would all look "new").
  const audioInputs = useVmixStore(
    useShallow((s) => s.vmixState?.inputs.filter((i) => i.hasAudio) ?? [])
  );
  const availableBuses = useVmixStore(
    useShallow((s) => s.vmixState?.audioBuses.map((b) => b.name) ?? [])
  );

  if (!connected || !vmixState) {
    return (
      <div className="flex flex-col">
        <TopBar status="offline" num="03" label="Console" title="Audio" sub="no vmix" />
        <Section>
          <div className="text-[13px] text-sw-muted py-12 text-center">
            {!connected
              ? "Connect to vMix to use the audio mixer."
              : "Loading…"}
          </div>
        </Section>
      </div>
    );
  }

  // Live master peak — max of L/R, expressed in dB. The colour ramp here
  // is broader than getGainColor (it warns earlier and clips at -3 dB)
  // because peak monitoring needs an obvious "hot" state, not just
  // "above unity".
  const masterPeak = Math.max(
    vmixState.audio.meterF1,
    vmixState.audio.meterF2
  );
  const masterPeakDb = meterToDb(masterPeak);
  const masterColor =
    masterPeakDb > -3
      ? "var(--pgm)"
      : masterPeakDb > -18
        ? "var(--amber)"
        : masterPeakDb > -60
          ? "var(--ink)"
          : "var(--muted)";

  return (
    <div className="flex flex-col">
      <TopBar
        status="live"
        num="03"
        label="Console"
        title={
          <>
            {audioInputs.length}{" "}
            <span className="text-sw-muted font-light">Strips.</span>
          </>
        }
        sub={`${audioInputs.length} channels · ${availableBuses.length} buses`}
        right={
          <ToolbarSlot label="Master peak">
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: masterColor,
                minWidth: 84,
                textAlign: "right",
              }}
            >
              {formatDb(masterPeakDb)}
            </span>
          </ToolbarSlot>
        }
      />

      {/* Strips — wrap to multiple rows like the colorimetry input strip,
          rather than scrolling horizontally. The fixed-width strips
          (116 px each) flow naturally; new rows are visually separated
          by the per-strip border-bottom. */}
      <div
        className="flex flex-wrap items-stretch"
        style={{ borderBottom: "1px solid var(--line-hi)" }}
      >
        {audioInputs.map((input, idx) => (
          <AudioStrip
            key={input.key}
            input={input}
            index={idx}
            availableBuses={availableBuses}
          />
        ))}

        <MasterStrip audio={vmixState.audio} />

        {vmixState.audioBuses.map((bus) => (
          <BusStrip key={bus.name} bus={bus} />
        ))}
      </div>

      {audioInputs.length === 0 && vmixState.audioBuses.length === 0 && (
        <Section>
          <div className="text-center text-[13px] text-sw-muted py-12">
            No audio inputs found.
          </div>
        </Section>
      )}
    </div>
  );
}
