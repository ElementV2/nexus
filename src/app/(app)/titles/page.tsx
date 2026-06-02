"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { useThrottle } from "@/lib/utils/throttle";
import { THROTTLE_RATE_MS } from "@/lib/vmix/constants";
import {
  setText,
  startCountdown,
  pauseCountdown,
  stopCountdown,
  setCountdown,
} from "@/lib/vmix/commands";
import type { VmixInput, VmixText } from "@/lib/vmix/types";
import { cn } from "@/lib/utils";
import {
  TopBar,
  Section,
  Eyebrow,
  ButtonGroup,
  Cell,
  StatusPill,
  MonoInput,
  SetButton,
} from "@/components/sw";

const TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

function isTimerField(text: VmixText): boolean {
  return (
    TIME_PATTERN.test(text.value) ||
    text.name.toLowerCase().includes("timer") ||
    text.name.toLowerCase().includes("countdown") ||
    text.name.toLowerCase().includes("clock")
  );
}

function secondsToHMS(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function TimeSegment({
  value,
  onChange,
  max,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  max: number;
  /** Accessible name announced by screen readers (Hours / Minutes /
   *  Seconds). The visual layout doesn't need a visible label — the
   *  HH:MM:SS group is conventional and self-explanatory. */
  label: string;
}) {
  // Wheel-to-step, bound natively as non-passive: React's onWheel is
  // passive, so preventDefault() there is ignored and logs a browser
  // warning. A native { passive: false } listener stops the page scrolling
  // while the operator dials a value.
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onChange(e.deltaY < 0 ? Math.min(max, value + 1) : Math.max(0, value - 1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [value, max, onChange]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={String(value).padStart(2, "0")}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (!isNaN(n)) onChange(Math.min(max, Math.max(0, n)));
      }}
      className="sw-input text-center font-mono"
      style={{ width: 50, fontSize: 22, fontWeight: 700, padding: "6px 0" }}
      aria-label={label}
    />
  );
}

function TimerControls({ input }: { input: VmixInput }) {
  const send = useVmixCommand();
  const isRunning = input.state === "Running";
  const isPaused = input.state === "Paused";

  const timerText = input.texts?.find(isTimerField);
  const liveTime = timerText?.value ?? "00:00:00";

  const [h, setH] = useState(0);
  const [m, setM] = useState(0);
  const [s, setS] = useState(0);

  const updateTime = (nh: number, nm: number, ns: number) => {
    send(setCountdown(input.number, secondsToHMS(nh * 3600 + nm * 60 + ns)));
  };
  const setHours = (v: number) => {
    setH(v);
    updateTime(v, m, s);
  };
  const setMinutes = (v: number) => {
    setM(v);
    updateTime(h, v, s);
  };
  const setSeconds = (v: number) => {
    setS(v);
    updateTime(h, m, v);
  };

  return (
    <div className="space-y-3">
      <div className="text-center">
        <span
          className="font-mono text-[32px] font-bold text-sw-text"
          style={{ letterSpacing: "0.04em", lineHeight: 1 }}
        >
          {liveTime}
        </span>
      </div>

      <div className="flex items-center justify-center gap-2">
        <TimeSegment value={h} onChange={setHours} max={23} label="Hours" />
        <span className="font-mono text-[18px] text-sw-muted">:</span>
        <TimeSegment value={m} onChange={setMinutes} max={59} label="Minutes" />
        <span className="font-mono text-[18px] text-sw-muted">:</span>
        <TimeSegment value={s} onChange={setSeconds} max={59} label="Seconds" />
      </div>

      <ButtonGroup>
        <Cell
          active={isRunning}
          role="green"
          onClick={() => send(startCountdown(input.number))}
          className="flex-1"
        >
          ▶ Play
        </Cell>
        <Cell
          active={isPaused}
          role="amber"
          onClick={() => send(pauseCountdown(input.number))}
          className="flex-1"
        >
          ⏸ Pause
        </Cell>
        <Cell
          active
          role="red"
          onClick={() => send(stopCountdown(input.number))}
          className="flex-1"
        >
          ⏹ Stop
        </Cell>
      </ButtonGroup>
    </div>
  );
}

function TextField({
  input,
  text,
  send,
}: {
  input: VmixInput;
  text: VmixText;
  send: ReturnType<typeof useVmixCommand>;
}) {
  const [editValue, setEditValue] = useState<string | null>(null);

  const throttledSetText = useThrottle(
    useCallback(
      (value: string) => {
        send(setText(input.number, value, text.index));
      },
      [send, input.number, text.index]
    ),
    THROTTLE_RATE_MS
  );

  const displayValue = editValue !== null ? editValue : text.value;
  const isModified = editValue !== null && editValue !== text.value;

  const handleChange = (value: string) => {
    setEditValue(value);
    throttledSetText(value);
  };

  const handleSend = () => {
    const value = editValue ?? text.value;
    send(setText(input.number, value, text.index));
  };

  if (editValue !== null && text.value === editValue) {
    setEditValue(null);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-sw-sub w-5 text-right">
          {String(text.index).padStart(2, "0")}
        </span>
        <span className="text-[10px] text-sw-muted truncate">{text.name}</span>
      </div>
      <div className="flex">
        <MonoInput
          value={displayValue}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSend();
            }
          }}
          className="flex-1"
          style={{ fontSize: 12, padding: "6px 10px" }}
        />
        <SetButton variant={isModified ? "red" : "default"} onClick={handleSend}>
          Set
        </SetButton>
      </div>
    </div>
  );
}

function TitleCard({ input }: { input: VmixInput }) {
  const send = useVmixCommand();
  const hasTimer = input.texts?.some(isTimerField) ?? false;
  const isRunning = input.state === "Running";

  const stateRole: "green" | "amber" | "muted" = isRunning
    ? "green"
    : input.state === "Paused"
      ? "amber"
      : "muted";

  return (
    <div
      className="sw-hairline-row"
      data-state={isRunning ? "pvw" : "default"}
      style={{ padding: 0 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-[18px] py-[12px] sw-hairline-bottom">
        <span
          className={cn(
            "font-mono text-[16px] font-bold w-[26px] text-center shrink-0",
            isRunning ? "text-sw-green" : "text-sw-text"
          )}
        >
          {String(input.number).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-sw-text truncate">
            {input.title}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Eyebrow tone="muted">{input.type}</Eyebrow>
            {hasTimer && (
              <StatusPill role={stateRole} glyph={isRunning ? "●" : "○"}>
                {input.state ?? "Stopped"}
              </StatusPill>
            )}
          </div>
        </div>
      </div>

      <div className="px-[18px] py-[12px] space-y-3">
        {hasTimer && <TimerControls input={input} />}

        {input.texts && input.texts.length > 0 && (
          <div className="space-y-3">
            {input.texts
              .filter((t) => !isTimerField(t))
              .map((text) => (
                <TextField key={text.index} input={input} text={text} send={send} />
              ))}
          </div>
        )}

        {(!input.texts || input.texts.length === 0) && !hasTimer && (
          <p className="text-[11px] text-sw-muted text-center py-3">
            No text fields.
          </p>
        )}
      </div>
    </div>
  );
}

export default function TitlesPage() {
  const vmixState = useVmixStore((s) => s.vmixState);
  const connected = useVmixStore((s) => s.connected);

  if (!connected || !vmixState) {
    return (
      <div className="flex flex-col">
        <TopBar status="offline" num="06" label="Text" title="Titles" sub="no vmix" />
        <Section>
          <div className="text-[13px] text-sw-muted py-12 text-center">
            {!connected ? "Connect to vMix to edit titles." : "Loading…"}
          </div>
        </Section>
      </div>
    );
  }

  const titleInputs = vmixState.inputs.filter(
    (i) => i.texts && i.texts.length > 0
  );

  const timerCount = titleInputs.filter((i) => i.texts?.some(isTimerField))
    .length;
  const textCount = titleInputs.length - timerCount;

  return (
    <div className="flex flex-col">
      <TopBar
        status="live"
        num="06"
        label="Titles & Timers"
        title={
          <>
            {titleInputs.length}{" "}
            <span className="text-sw-muted font-light">Titles.</span>
          </>
        }
        sub={`${titleInputs.length} inputs · ${timerCount} timer${timerCount !== 1 ? "s" : ""} · ${textCount} title${textCount !== 1 ? "s" : ""}`}
      />

      {titleInputs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 border-b-[1.5px] border-sw-line-2">
          {titleInputs.map((input) => (
            <TitleCard key={input.key} input={input} />
          ))}
        </div>
      ) : (
        <Section>
          <div className="text-[13px] text-sw-muted py-16 text-center">
            No GT / Title inputs found.
          </div>
        </Section>
      )}
    </div>
  );
}
