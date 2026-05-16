"use client";

import { useState } from "react";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import {
  setOutput,
  overlayInput,
  transitionInput,
  previewInput,
} from "@/lib/vmix/commands";
import {
  OUTPUT_OPTIONS,
  OVERLAY_CHANNELS,
  STINGER_CHANNELS,
} from "@/lib/vmix/constants";
import type { VmixTransition, VmixOverlay, VmixOutput, VmixMix } from "@/lib/vmix/types";

export interface MixInfo {
  label: string;
  apiIndex: number;
}

export interface TransitionOption {
  label: string;
  fn: string;
  duration?: number;
  supportsMix: boolean;
}

export interface TallyInfo {
  activeInput: number;
  previewInput: number;
  overlays: VmixOverlay[];
  outputs: VmixOutput[];
  mixes: VmixMix[];
}

interface OutputButtonsProps {
  inputTitle: string;
  inputNumber: number;
  mixes?: MixInfo[];
  transitions?: TransitionOption[];
  tally?: TallyInfo;
}

// Inline styles for the target buttons (PGM / PVW / per-Mix / OVL).
// Tactical Refined: rectangular, no shadows, tinted bg in signal color when active.
const btnBase = (active?: { fg: string; tint: string }): React.CSSProperties => ({
  height: 26,
  padding: "0 10px",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "1.4px",
  textTransform: "uppercase",
  fontFamily: "var(--font-mono)",
  background: active ? active.tint : "var(--card)",
  color: active ? active.fg : "var(--mid)",
  border: `1px solid ${active ? active.fg : "var(--line)"}`,
  transition: "background 80ms ease, color 80ms ease",
});
const TONE_PGM = { fg: "var(--pgm)", tint: "var(--pgm-tint)" };
const TONE_PVW = { fg: "var(--pvw)", tint: "var(--pvw-tint)" };
const TONE_AMBER = { fg: "var(--amber)", tint: "var(--amber-tint)" };

export function buildTransitionOptions(
  _vmixTransitions: VmixTransition[]
): TransitionOption[] {
  // Named transition functions vMix accepts with an Input parameter.
  // Stinger count tracks vMix's GUI (8 in vMix 27+) — before this fix
  // we only exposed Stinger1 hard-wired, so clicking "Stinger 2"
  // still fired Stinger 1. Pulled from STINGER_CHANNELS so a vMix
  // bump is a one-line change.
  return [
    { label: "Cut",   fn: "Cut",   supportsMix: true },
    { label: "Fade",  fn: "Fade",  duration: 500, supportsMix: true },
    { label: "Merge", fn: "Merge", duration: 500, supportsMix: true },
    ...STINGER_CHANNELS.map(
      (n): TransitionOption => ({
        label: `Stinger ${n}`,
        fn: `Stinger${n}`,
        supportsMix: true,
      })
    ),
  ];
}

export function OutputButtons({
  inputTitle,
  inputNumber,
  mixes = [],
  transitions = [],
  tally,
}: OutputButtonsProps) {
  const send = useVmixCommand();
  const [selectedPgm, setSelectedPgm] = useState(0);
  const [selectedMix, setSelectedMix] = useState(0);

  const pgmTransition = transitions[selectedPgm] ?? { label: "Cut", fn: "Cut", supportsMix: true };
  const mixTransitions = transitions.filter((t) => t.supportsMix);
  const mixTransition = mixTransitions[selectedMix] ?? { label: "Cut", fn: "Cut", supportsMix: true };

  // Tally state
  const isPgm = tally ? inputNumber === tally.activeInput : false;
  const isPvw = tally ? inputNumber === tally.previewInput : false;
  const activeOverlays = tally
    ? tally.overlays.filter((o) => o.inputNumber === inputNumber).map((o) => o.number)
    : [];

  /** Check if this input is on a specific mix's program or preview */
  const mixTally = (apiIndex: number): "pgm" | "pvw" | null => {
    if (!tally) return null;
    // apiIndex 1 = Mix2 (XML @_number=2), apiIndex 2 = Mix3, etc.
    const mix = tally.mixes.find((m) => m.number === apiIndex + 1);
    if (!mix) return null;
    if (mix.active === inputNumber) return "pgm";
    if (mix.preview === inputNumber) return "pvw";
    return null;
  };

  /** Check if this input is routed to a specific output */
  const isOnOutput = (xmlType: string, xmlNumber: number) => {
    if (!tally) return false;
    return tally.outputs.some(
      (o) => o.type === xmlType && o.number === xmlNumber && o.source === "Input" && o.inputNumber === inputNumber
    );
  };

  const pickerBtn = (active: boolean): React.CSSProperties => ({
    height: 22,
    padding: "0 8px",
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: "1.2px",
    textTransform: "uppercase",
    background: active ? "var(--card-hi)" : "var(--card)",
    color: active ? "var(--ink)" : "var(--muted)",
    border: `1px solid ${active ? "var(--line-hi)" : "var(--line)"}`,
    transition: "background 80ms ease",
  });

  return (
    <div className="space-y-2">
      {/* PGM transition picker */}
      {transitions.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="label" style={{ fontSize: 9 }}>
            PGM
          </span>
          <div className="flex flex-wrap gap-1">
            {transitions.map((t, idx) => (
              <button
                key={t.fn}
                onClick={() => setSelectedPgm(idx)}
                style={pickerBtn(idx === selectedPgm)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mix transition picker */}
      {mixes.length > 0 && mixTransitions.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="label" style={{ fontSize: 9 }}>
            MIX
          </span>
          <div className="flex flex-wrap gap-1">
            {mixTransitions.map((t, idx) => (
              <button
                key={t.fn}
                onClick={() => setSelectedMix(idx)}
                style={pickerBtn(idx === selectedMix)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Target buttons */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() =>
            send(transitionInput(pgmTransition.fn, inputNumber, pgmTransition.duration))
          }
          style={btnBase(isPgm ? TONE_PGM : undefined)}
        >
          PGM
        </button>

        <button
          onClick={() => send(previewInput(inputNumber))}
          style={btnBase(isPvw ? TONE_PVW : undefined)}
        >
          PVW
        </button>

        {mixes.map((mix) => {
          const mt = mixTally(mix.apiIndex);
          const tone = mt === "pgm" ? TONE_PGM : mt === "pvw" ? TONE_PVW : undefined;
          return (
            <button
              key={mix.apiIndex}
              onClick={() =>
                send(
                  transitionInput(
                    mixTransition.fn,
                    inputNumber,
                    mixTransition.duration,
                    mix.apiIndex
                  )
                )
              }
              style={btnBase(tone)}
            >
              {mix.label}
            </button>
          );
        })}

        {OUTPUT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => send(setOutput(opt.value, inputTitle))}
            style={btnBase(
              isOnOutput(opt.xmlType, opt.xmlNumber) ? TONE_PGM : undefined
            )}
          >
            {opt.label}
          </button>
        ))}

        {OVERLAY_CHANNELS.map((n) => (
          <button
            key={`ovl-${n}`}
            onClick={() => send(overlayInput(n, inputTitle))}
            style={btnBase(activeOverlays.includes(n) ? TONE_AMBER : undefined)}
          >
            OVL{n}
          </button>
        ))}
      </div>
    </div>
  );
}
