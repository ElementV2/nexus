"use client";

import { useCallback, useMemo } from "react";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { useAudioFader } from "@/hooks/use-audio-fader";
import {
  transitionInput,
  previewInput,
  setOutput,
  overlayInput,
  setVolume,
  audioOn,
  audioOff,
  audioBusOn,
  audioBusOff,
  selectIndex,
  listRemove,
  nextItem,
  previousItem,
  videoCallAudioSource,
  videoCallVideoSource,
} from "@/lib/vmix/commands";
import { OUTPUT_OPTIONS, OVERLAY_CHANNELS } from "@/lib/vmix/constants";
import type { AudioBus } from "@/lib/vmix/constants";
import type { VmixInput } from "@/lib/vmix/types";
import { formatDb } from "@/lib/utils/audio";
import { VuMeter } from "@/components/audio/vu-meter";
import { BusButton } from "@/components/audio/bus-button";
import { Slider } from "@/components/ui/slider";
import { TransportControls } from "@/components/playlist/transport-controls";
import { cn } from "@/lib/utils";
import type { TransitionOption } from "@/components/playlist/output-buttons";
import { ButtonGroup, Cell, Eyebrow } from "@/components/sw";
import {
  shortType,
  VIDEO_CALL_AUDIO_BASE,
  VIDEO_CALL_VIDEO_SOURCES,
  type MixInfo,
  type TallyInfo,
} from "./helpers";

/**
 * The expanded panel that slides in below the Live grid when an input
 * is selected. Hosts every advanced control (routing, audio, list
 * transport, video call settings) so the tile itself can stay compact.
 */
export function DetailsPanel({
  input,
  pgmTransition,
  mixTransition,
  send,
  availableBuses,
  tally,
  mixes,
}: {
  input: VmixInput;
  pgmTransition: TransitionOption;
  mixTransition: TransitionOption;
  send: ReturnType<typeof useVmixCommand>;
  availableBuses: string[];
  tally: TallyInfo;
  mixes: MixInfo[];
}) {
  const isMixType = input.type === "Mix";
  const isVideoCall = input.type === "VideoCall";
  const activeOverlays = tally.overlays
    .filter((o) => o.inputNumber === input.number)
    .map((o) => o.number);

  const activeBusses = input.audioBusses.split(",").filter(Boolean);

  // Optimistic-UI volume fader — same hook the AudioPage strips use,
  // wired through `pushSlider`/`commitSlider` (the 0..100 variants)
  // because the shadcn <Slider> on this panel emits 0..100 directly
  // rather than the 0..1 ratio FaderStrip uses.
  const sendVolume = useCallback(
    (sliderPos: number) => send(setVolume(input.number, sliderPos)),
    [send, input.number]
  );
  const {
    displaySlider,
    db,
    onChangeStart: onSliderStart,
    pushSlider,
    commitSlider,
  } = useAudioFader({ volume: input.volume, send: sendVolume });

  const handleMuteToggle = () => {
    send(input.muted ? audioOn(input.number) : audioOff(input.number));
  };
  const handleBusToggle = (bus: string) => {
    const isActive = activeBusses.includes(bus);
    send(
      isActive
        ? audioBusOff(input.number, bus)
        : audioBusOn(input.number, bus)
    );
  };

  const mixTally = (apiIndex: number): "pgm" | "pvw" | null => {
    const mix = tally.mixes.find((m) => m.number === apiIndex + 1);
    if (!mix) return null;
    if (mix.active === input.number) return "pgm";
    if (mix.preview === input.number) return "pvw";
    return null;
  };

  const isOnOutput = (xmlType: string, xmlNumber: number) =>
    tally.outputs.some(
      (o) =>
        o.type === xmlType &&
        o.number === xmlNumber &&
        o.source === "Input" &&
        o.inputNumber === input.number
    );

  const hasItems = (input.items?.length ?? 0) > 0;

  // Stable ref for the video-call audio source list — only re-derived
  // when the bus list actually changes.
  const videoCallAudioSources = useMemo(
    () => [...VIDEO_CALL_AUDIO_BASE, ...availableBuses.map((b) => `Bus${b}`)],
    [availableBuses]
  );

  return (
    <section
      style={{
        background: "var(--panel)",
        borderTop: "1px solid var(--line)",
      }}
    >
      {/* Header strip */}
      <div
        className="flex items-center justify-between gap-4"
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="flex items-center gap-4">
          <span
            className="font-mono font-bold"
            style={{
              fontSize: 24,
              letterSpacing: "-0.04em",
              color: "var(--ink)",
            }}
          >
            {String(input.number).padStart(2, "0")}
          </span>
          <div>
            <span className="label">{shortType(input)}</span>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                marginTop: 2,
              }}
            >
              {input.title}
            </div>
          </div>
        </div>
      </div>

      {/* Routing cells */}
      <div className="px-[24px] py-[14px] space-y-3">
        <Eyebrow tone="muted">Routing</Eyebrow>
        <div className="flex flex-wrap pr-px pb-px">
          <Cell
            active={tally.activeInput === input.number}
            role="red"
            onClick={() =>
              send(
                transitionInput(
                  pgmTransition.fn,
                  input.number,
                  pgmTransition.duration
                )
              )
            }
          >
            PGM
          </Cell>
          <Cell
            active={tally.previewInput === input.number}
            role="green"
            onClick={() => send(previewInput(input.number))}
          >
            PVW
          </Cell>
          {mixes
            .filter(
              (mix) =>
                !isMixType ||
                mix.apiIndex !==
                  parseInt(input.shortTitle.replace(/\D/g, ""), 10) - 1
            )
            .map((mix) => {
              const mt = mixTally(mix.apiIndex);
              return (
                <Cell
                  key={mix.apiIndex}
                  active={mt !== null}
                  role={mt === "pgm" ? "red" : "green"}
                  onClick={() =>
                    send(
                      transitionInput(
                        mixTransition.fn,
                        input.number,
                        mixTransition.duration,
                        mix.apiIndex
                      )
                    )
                  }
                >
                  {mix.label}
                </Cell>
              );
            })}
          {OUTPUT_OPTIONS.map((opt) => (
            <Cell
              key={opt.value}
              active={isOnOutput(opt.xmlType, opt.xmlNumber)}
              role="red"
              onClick={() => send(setOutput(opt.value, input.title))}
            >
              {opt.label}
            </Cell>
          ))}
          {OVERLAY_CHANNELS.map((n) => (
            <Cell
              key={`ovl-${n}`}
              active={activeOverlays.includes(n)}
              role="red"
              onClick={() => send(overlayInput(n, input.title))}
            >
              OVL{n}
            </Cell>
          ))}
        </div>
      </div>

      {/* Transport (for list inputs) */}
      {(hasItems || input.duration > 0) && (
        <div className="px-[24px] py-[14px] sw-hairline-top">
          <Eyebrow tone="muted" className="mb-3">
            Transport
          </Eyebrow>
          {input.duration > 0 ? <TransportControls input={input} /> : null}
        </div>
      )}

      {/* Audio */}
      {input.hasAudio && (
        <div className="px-[24px] py-[14px] sw-hairline-top space-y-3">
          <Eyebrow tone="muted">Audio</Eyebrow>
          <div className="space-y-1">
            <VuMeter amplitude={input.meterF1} muted={input.muted} />
            <VuMeter amplitude={input.meterF2} muted={input.muted} />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleMuteToggle}
              data-active="true"
              data-role={input.muted ? "red" : "green"}
              className="sw-cell"
              style={{ minWidth: 80, padding: "8px 12px" }}
            >
              {input.muted ? "● Muted" : "● Live"}
            </button>
            <Slider
              value={[displaySlider]}
              min={0}
              max={100}
              step={0.5}
              onValueChange={(vals) => pushSlider(vals[0])}
              onPointerDown={onSliderStart}
              onPointerUp={() => commitSlider(displaySlider)}
              className="flex-1"
            />
            <span
              className="font-mono text-sw-text text-right"
              style={{ minWidth: 64, fontSize: 13, fontWeight: 600 }}
            >
              {formatDb(db)}
            </span>
          </div>
          <div className="flex flex-wrap pr-px pb-px">
            {["M", ...availableBuses].map((bus) => (
              <div key={bus} style={{ width: 36 }}>
                <BusButton
                  bus={bus as AudioBus}
                  active={activeBusses.includes(bus)}
                  onToggle={() => handleBusToggle(bus)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* List items */}
      {hasItems && (
        <div className="px-[24px] py-[14px] sw-hairline-top space-y-2">
          <Eyebrow tone="muted">List Items</Eyebrow>
          <ButtonGroup>
            <Cell
              onClick={() => send(previousItem(input.number))}
              className="flex-1"
            >
              ↑ Prev
            </Cell>
            <Cell
              onClick={() => send(nextItem(input.number))}
              className="flex-1"
            >
              Next ↓
            </Cell>
          </ButtonGroup>
          <div
            className="max-h-72 overflow-y-auto"
            style={{ border: "1px solid var(--line)" }}
          >
            {input.items!.map((item, idx) => (
              <div
                key={`${item.source}-${idx}`}
                className={cn(
                  "flex items-center gap-2 px-3 py-2",
                  "sw-hairline-bottom last:border-b-0",
                  item.selected && "bg-sw-panel-alt"
                )}
              >
                <span
                  className="font-mono text-sw-sub w-5 text-right"
                  style={{ fontSize: 10 }}
                >
                  {idx + 1}
                </span>
                <button
                  onClick={() => send(selectIndex(input.number, idx + 1))}
                  className={cn(
                    "min-w-0 flex-1 text-left truncate",
                    item.selected
                      ? "text-sw-green font-semibold"
                      : "text-sw-text"
                  )}
                  style={{ fontSize: 12 }}
                >
                  {item.source.split(/[/\\]/).pop()}
                </button>
                <button
                  onClick={() => send(listRemove(input.number, idx + 1))}
                  className="text-sw-muted hover:text-sw-red"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Video call */}
      {isVideoCall && (
        <div className="px-[24px] py-[14px] sw-hairline-top space-y-3">
          <Eyebrow tone="muted">Video Call</Eyebrow>
          <div className="flex items-center gap-3">
            <span
              className="font-mono uppercase"
              style={{
                fontSize: 10,
                letterSpacing: "0.18em",
                color: input.callConnected ? "var(--pvw)" : "var(--muted)",
              }}
            >
              {input.callConnected ? "● Connected" : "○ Disconnected"}
            </span>
            {input.callPassword && (
              <span className="font-mono text-sw-muted text-[10px]">
                ID: {input.callPassword}
              </span>
            )}
          </div>
          <div className="space-y-2">
            <Eyebrow tone="muted">Audio source</Eyebrow>
            <div className="flex flex-wrap pr-px pb-px">
              {videoCallAudioSources.map((src) => (
                <Cell
                  key={src}
                  active={input.callAudioSource === src}
                  role="blue"
                  onClick={() => send(videoCallAudioSource(input.number, src))}
                >
                  {src}
                </Cell>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Eyebrow tone="muted">Video source</Eyebrow>
            <div className="flex flex-wrap pr-px pb-px">
              {VIDEO_CALL_VIDEO_SOURCES.map((src) => (
                <Cell
                  key={src}
                  active={
                    input.callVideoSource === src ||
                    (!input.callVideoSource && src === "None")
                  }
                  role="purple"
                  onClick={() =>
                    send(videoCallVideoSource(input.number, src))
                  }
                >
                  {src === "None" ? "None" : src.replace("Output", "Out ")}
                </Cell>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
