"use client";

import { useCallback, useEffect, useState } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { useOptimisticValue } from "@/hooks/use-optimistic-value";
import { WheelGroup } from "@/components/colorimetry/wheel-group";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_SENSITIVITY,
  OUTPUT_OPTIONS,
  THROTTLE_RATE_MS,
} from "@/lib/vmix/constants";
import {
  setCCHue,
  setCCSaturation,
  colourCorrectionReset,
  setOutput,
} from "@/lib/vmix/commands";
import {
  TopBar,
  Section,
  ToolbarSlot,
  StatusPill,
} from "@/components/sw";
import { RotateCcw } from "lucide-react";

type OutputOption = (typeof OUTPUT_OPTIONS)[number];

const PREVIEW_OUTPUT_LS_KEY = "colorimetry-preview-output";

/** Look up the saved preview output choice. Returns `null` for "None"
 *  (the explicit user choice or the default for first-time visitors)
 *  or an OutputOption matching one of OUTPUT_OPTIONS. */
function loadPreviewOutput(): OutputOption | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREVIEW_OUTPUT_LS_KEY);
    if (raw === null) return null; // never set → default to None
    if (raw === "none") return null;
    return OUTPUT_OPTIONS.find((o) => o.value === raw) ?? null;
  } catch {
    return null;
  }
}

function savePreviewOutput(opt: OutputOption | null) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREVIEW_OUTPUT_LS_KEY, opt ? opt.value : "none");
  } catch {
    /* private mode / quota — UI keeps working, just won't persist */
  }
}

export default function ColorimetryPage() {
  const vmixState = useVmixStore((s) => s.vmixState);
  const connected = useVmixStore((s) => s.connected);
  const send = useVmixCommand();
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY);
  // Preview output — when the user picks a source from the strip we
  // also route it to this output so they can monitor the grade live.
  // `null` = "None": the wheels still work but we skip the SetOutput
  // call, so a grade adjustment doesn't yank the routing mid-show.
  //
  // Default to None (no implicit routing). Persisted in localStorage
  // so the operator's chosen output sticks across reloads. The lazy
  // initialiser keeps the SSR snapshot stable (always `null`) — the
  // first client effect below picks the saved value up after mount.
  const [previewOutput, setPreviewOutput] = useState<OutputOption | null>(
    null
  );
  useEffect(() => {
    setPreviewOutput(loadPreviewOutput());
  }, []);
  const updatePreviewOutput = useCallback((opt: OutputOption | null) => {
    setPreviewOutput(opt);
    savePreviewOutput(opt);
  }, []);

  // Auto-select a default input the first time vMix data arrives. Lives
  // in a useEffect (rather than the render body) so we don't fire it on
  // every poll tick, and so it only ever runs once per page mount.
  useEffect(() => {
    if (selectedInput) return;
    if (!vmixState || vmixState.inputs.length === 0) return;
    const activeNum = vmixState.activeInput;
    const activeExists = vmixState.inputs.some((i) => i.number === activeNum);
    setSelectedInput(
      String(activeExists ? activeNum : vmixState.inputs[0].number)
    );
    // We intentionally only depend on the data presence — not on activeInput
    // changes — so the user's selection never gets overridden after the
    // initial pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmixState?.inputs.length]);

  if (!connected || !vmixState) {
    return (
      <div className="flex flex-col">
        <TopBar status="offline" num="04" label="Grade" title="Color" sub="no vmix" />
        <Section>
          <div className="text-[13px] text-sw-muted py-12 text-center">
            {!connected ? "Connect to vMix to adjust color." : "Loading…"}
          </div>
        </Section>
      </div>
    );
  }

  const input = vmixState.inputs.find(
    (i) => String(i.number) === selectedInput
  );

  const handleSelectInput = (n: number) => {
    setSelectedInput(String(n));
    // In "None" mode the routing is left alone — the user can adjust
    // wheels / sliders on an input without touching any physical
    // output. Useful mid-show when you want to refine a grade without
    // ever pulling the source from PGM / preview / external.
    if (previewOutput) {
      send(setOutput(previewOutput.value, String(n)));
    }
  };

  return (
    <div className="flex flex-col h-full">
      <TopBar
        status="live"
        num="04"
        label="Color"
        title={
          input ? (
            <>
              <span className="font-mono">
                {String(input.number).padStart(2, "0")}
              </span>{" "}
              <span className="text-sw-muted font-light">·</span> {input.title}
            </>
          ) : (
            <>No selection.</>
          )
        }
        sub={input?.shortTitle?.toLowerCase() ?? "select an input"}
        right={
          <div className="flex items-stretch gap-0">
            <ToolbarSlot label="Preview output">
              <div className="inline-flex">
                {/* "None" — disable the implicit SetOutput routing
                    when picking an input. The wheels / sliders still
                    write to the selected input, just without yanking
                    a physical output. */}
                {(() => {
                  const isNoneActive = previewOutput === null;
                  return (
                    <button
                      onClick={() => updatePreviewOutput(null)}
                      className="font-mono uppercase transition-colors"
                      style={{
                        padding: "4px 10px",
                        fontSize: 10,
                        letterSpacing: "1.4px",
                        fontWeight: 600,
                        background: isNoneActive
                          ? "var(--amber-tint)"
                          : "var(--card)",
                        color: isNoneActive ? "var(--amber)" : "var(--mid)",
                        border: `1px solid ${
                          isNoneActive ? "var(--amber)" : "var(--line)"
                        }`,
                        marginLeft: 0,
                        position: "relative",
                        zIndex: isNoneActive ? 2 : 1,
                        transitionDuration: "80ms",
                      }}
                      aria-pressed={isNoneActive}
                      title="Don't route picked sources to any output"
                    >
                      None
                    </button>
                  );
                })()}
                {OUTPUT_OPTIONS.map((opt) => {
                  const isActive = previewOutput?.value === opt.value;
                  const color = isActive ? "var(--amber)" : "var(--line)";
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        updatePreviewOutput(opt);
                        // If a source is already selected, re-route it
                        // to the new preview output immediately so the
                        // operator's next mouse move shows the grade
                        // on the freshly-picked output.
                        if (input)
                          send(setOutput(opt.value, String(input.number)));
                      }}
                      className="font-mono uppercase transition-colors"
                      style={{
                        padding: "4px 10px",
                        fontSize: 10,
                        letterSpacing: "1.4px",
                        fontWeight: 600,
                        background: isActive
                          ? "var(--amber-tint)"
                          : "var(--card)",
                        color: isActive ? "var(--amber)" : "var(--mid)",
                        border: `1px solid ${color}`,
                        marginLeft: -1,
                        position: "relative",
                        zIndex: isActive ? 2 : 1,
                        transitionDuration: "80ms",
                      }}
                      aria-pressed={isActive}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </ToolbarSlot>
            <ToolbarSlot label="Sensitivity">
              <div className="flex items-center gap-3 w-[200px]">
                <Slider
                  value={[sensitivity]}
                  min={0.01}
                  max={1}
                  step={0.01}
                  onValueChange={([v]) => setSensitivity(v)}
                  className="flex-1"
                />
                <span className="font-mono text-[11px] text-sw-text-dim w-10 text-right">
                  {sensitivity.toFixed(2)}
                </span>
              </div>
            </ToolbarSlot>
            {input && (
              <button
                onClick={() => send(colourCorrectionReset(input.number))}
                className="flex items-center gap-2 font-mono uppercase transition-colors"
                style={{
                  padding: "0 16px",
                  fontSize: 11,
                  letterSpacing: "1.4px",
                  fontWeight: 600,
                  color: "var(--amber)",
                  background: "transparent",
                  borderLeft: "1px solid var(--line)",
                  transitionDuration: "80ms",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--amber-tint)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
                title="Reset all colour correction for this input"
              >
                <RotateCcw style={{ width: 13, height: 13 }} />
                Reset all
              </button>
            )}
          </div>
        }
      />

      <InputStrip
        inputs={vmixState.inputs}
        selectedNumber={input?.number ?? null}
        activeInput={vmixState.activeInput}
        previewInput={vmixState.previewInput}
        overlays={vmixState.overlays}
        onSelect={handleSelectInput}
      />

      {input ? (
        <>
          <Section>
            <WheelGroup input={input} sensitivity={sensitivity} />
          </Section>

          <BottomBar
            hue={input.cc.hue}
            saturation={input.cc.saturation}
            inputNumber={input.number}
          />
        </>
      ) : (
        <Section>
          <div className="py-20 text-center text-[13px] text-sw-muted">
            Select an input to adjust color correction.
          </div>
        </Section>
      )}
    </div>
  );
}

/* ── Input strip: wrap-grid of input chips at the top of the page ── */
function InputStrip({
  inputs,
  selectedNumber,
  activeInput,
  previewInput,
  overlays,
  onSelect,
}: {
  inputs: import("@/lib/vmix/types").VmixInput[];
  selectedNumber: number | null;
  activeInput: number;
  previewInput: number;
  overlays: { inputNumber: number }[];
  onSelect: (n: number) => void;
}) {
  return (
    <div
      className="flex flex-wrap"
      style={{
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {inputs.map((inp) => {
        const isSelected = selectedNumber === inp.number;
        const isPGM = inp.number === activeInput;
        const isPVW = inp.number === previewInput;
        const isOVL = overlays.some((o) => o.inputNumber === inp.number);
        const isLive = isPGM || isOVL;

        return (
          <button
            key={inp.key}
            onClick={() => onSelect(inp.number)}
            className="relative flex items-center font-mono uppercase transition-colors"
            style={{
              gap: 8,
              padding: "10px 14px",
              fontSize: 11,
              letterSpacing: "0.14em",
              fontWeight: 600,
              minWidth: 110,
              background: isSelected ? "var(--amber-tint)" : "transparent",
              color: isSelected ? "var(--amber)" : "var(--mid)",
              borderRight: "1px solid var(--line)",
              borderBottom: "1px solid var(--line)",
              transitionDuration: "80ms",
            }}
          >
            {isSelected && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: "var(--amber)",
                }}
              />
            )}
            <span
              className="font-mono"
              style={{
                color: isSelected ? "var(--amber)" : "var(--sub)",
                fontWeight: 500,
              }}
            >
              {String(inp.number).padStart(2, "0")}
            </span>
            <span className="truncate max-w-[140px]">
              {inp.shortTitle || inp.title}
            </span>
            {isLive && (
              <StatusPill role="red" glyph="●">
                PGM
              </StatusPill>
            )}
            {isPVW && !isLive && (
              <StatusPill role="green" glyph="●">
                PVW
              </StatusPill>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Bottom bar: SATURATION + HUE sliders, full width, sticky at the bottom ── */
// Hue + Saturation are centered ratios in -1..1; a 0.001 tolerance is
// well below operator perception but past the float-rounding floor
// that vMix sends back, so the optimistic override expires cleanly
// once the real value has moved.
const COLOR_EQUALS = (a: number, b: number) => Math.abs(a - b) < 0.001;

function BottomBar({
  hue: propHue,
  saturation: propSat,
  inputNumber,
}: {
  hue: number;
  saturation: number;
  inputNumber: number;
}) {
  const send = useVmixCommand();

  const sendHue = useCallback(
    (v: number) => send(setCCHue(inputNumber, v)),
    [send, inputNumber]
  );
  const sendSat = useCallback(
    (v: number) => send(setCCSaturation(inputNumber, v)),
    [send, inputNumber]
  );

  const hueOpt = useOptimisticValue<number>(propHue, sendHue, {
    throttleMs: THROTTLE_RATE_MS,
    equals: COLOR_EQUALS,
  });
  const satOpt = useOptimisticValue<number>(propSat, sendSat, {
    throttleMs: THROTTLE_RATE_MS,
    equals: COLOR_EQUALS,
  });

  const fmtSigned = (n: number, suffix = "") => {
    const s = n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
    return `${s}${suffix}`;
  };

  return (
    <div
      className="sticky bottom-0 z-10"
      style={{
        background: "var(--panel)",
        borderTop: "1px solid var(--line)",
      }}
    >
      <BarSlot
        label="Saturation"
        value={satOpt.display}
        displayValue={fmtSigned(satOpt.display)}
        min={-1}
        max={1}
        onChange={satOpt.onChange}
        onPointerDown={satOpt.onChangeStart}
        onPointerUp={() => satOpt.onChangeEnd(satOpt.display)}
      />
      <div style={{ borderTop: "1px solid var(--line)" }} />
      <BarSlot
        label="Hue"
        value={hueOpt.display}
        displayValue={fmtSigned(hueOpt.display, "°")}
        min={-1}
        max={1}
        onChange={hueOpt.onChange}
        onPointerDown={hueOpt.onChangeStart}
        onPointerUp={() => hueOpt.onChangeEnd(hueOpt.display)}
      />
    </div>
  );
}

function BarSlot({
  label,
  value,
  displayValue,
  min,
  max,
  onChange,
  onPointerDown,
  onPointerUp,
}: {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
}) {
  return (
    <div className="flex items-center" style={{ gap: 16, padding: "12px 24px" }}>
      <span className="label shrink-0" style={{ width: 90 }}>
        {label}
      </span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={0.01}
        onValueChange={([v]) => onChange(v)}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="flex-1"
      />
      <span
        className="font-mono tabular-nums shrink-0 text-right"
        style={{ fontSize: 12, width: 64, color: "var(--ink)" }}
      >
        {displayValue}
      </span>
    </div>
  );
}
