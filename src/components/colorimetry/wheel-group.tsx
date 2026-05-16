"use client";

import { useCallback } from "react";
import { ColorWheel } from "./color-wheel";
import { YSlider } from "./y-slider";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { useThrottle } from "@/lib/utils/throttle";
import {
  setCCParam,
} from "@/lib/vmix/commands";
import { THROTTLE_RATE_MS } from "@/lib/vmix/constants";
import { RotateCcw } from "lucide-react";
import type { VmixInput } from "@/lib/vmix/types";

interface WheelGroupProps {
  input: VmixInput;
  sensitivity?: number;
}

type Wheel = "Lift" | "Gamma" | "Gain";

export function WheelGroup({ input, sensitivity = 0.1 }: WheelGroupProps) {
  const send = useVmixCommand();
  const { cc } = input;

  const throttledWheelChange = useThrottle(
    useCallback(
      (wheel: Wheel, r: number, g: number, b: number) => {
        send(setCCParam(wheel, "R", input.number, r));
        send(setCCParam(wheel, "G", input.number, g));
        send(setCCParam(wheel, "B", input.number, b));
      },
      [send, input.number]
    ),
    THROTTLE_RATE_MS
  );

  const throttledSendY = useThrottle(
    useCallback(
      (wheel: Wheel, value: number) => {
        send(setCCParam(wheel, "Y", input.number, value));
      },
      [send, input.number]
    ),
    THROTTLE_RATE_MS
  );

  const sendWheelDirect = useCallback(
    (wheel: Wheel, r: number, g: number, b: number) => {
      send(setCCParam(wheel, "R", input.number, r));
      send(setCCParam(wheel, "G", input.number, g));
      send(setCCParam(wheel, "B", input.number, b));
    },
    [send, input.number]
  );

  const resetWheel = useCallback(
    (wheel: Wheel) => {
      const defR = wheel === "Gain" ? 1 : 0;
      const defG = wheel === "Gain" ? 1 : 0;
      const defB = wheel === "Gain" ? 1 : 0;
      send(setCCParam(wheel, "R", input.number, defR));
      send(setCCParam(wheel, "G", input.number, defG));
      send(setCCParam(wheel, "B", input.number, defB));
      send(setCCParam(wheel, "Y", input.number, wheel === "Gain" ? 1 : 0));
    },
    [send, input.number]
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-8">
      <WheelCell
        label="LIFT"
        r={cc.liftR - cc.liftY}
        g={cc.liftG - cc.liftY}
        b={cc.liftB - cc.liftY}
        y={cc.liftY}
        yMin={-1}
        yMax={1}
        sensitivity={sensitivity}
        onWheelChange={(r, g, b) =>
          throttledWheelChange("Lift", r + cc.liftY, g + cc.liftY, b + cc.liftY)
        }
        onWheelChangeEnd={(r, g, b) =>
          sendWheelDirect("Lift", r + cc.liftY, g + cc.liftY, b + cc.liftY)
        }
        onYChange={(v) => throttledSendY("Lift", v)}
        onYChangeEnd={(v) => send(setCCParam("Lift", "Y", input.number, v))}
        onReset={() => resetWheel("Lift")}
      />
      <WheelCell
        label="GAMMA"
        r={cc.gammaR - cc.gammaY}
        g={cc.gammaG - cc.gammaY}
        b={cc.gammaB - cc.gammaY}
        y={cc.gammaY}
        yMin={-1}
        yMax={1}
        sensitivity={sensitivity}
        onWheelChange={(r, g, b) =>
          throttledWheelChange(
            "Gamma",
            r + cc.gammaY,
            g + cc.gammaY,
            b + cc.gammaY
          )
        }
        onWheelChangeEnd={(r, g, b) =>
          sendWheelDirect("Gamma", r + cc.gammaY, g + cc.gammaY, b + cc.gammaY)
        }
        onYChange={(v) => throttledSendY("Gamma", v)}
        onYChangeEnd={(v) => send(setCCParam("Gamma", "Y", input.number, v))}
        onReset={() => resetWheel("Gamma")}
      />
      <WheelCell
        label="GAIN"
        r={cc.gainR - cc.gainY}
        g={cc.gainG - cc.gainY}
        b={cc.gainB - cc.gainY}
        y={cc.gainY}
        yMin={0}
        yMax={2}
        sensitivity={sensitivity}
        onWheelChange={(r, g, b) =>
          throttledWheelChange("Gain", r + cc.gainY, g + cc.gainY, b + cc.gainY)
        }
        onWheelChangeEnd={(r, g, b) =>
          sendWheelDirect("Gain", r + cc.gainY, g + cc.gainY, b + cc.gainY)
        }
        onYChange={(v) => throttledSendY("Gain", v)}
        onYChangeEnd={(v) => send(setCCParam("Gain", "Y", input.number, v))}
        onReset={() => resetWheel("Gain")}
      />
    </div>
  );
}

function WheelCell({
  label,
  r,
  g,
  b,
  y,
  yMin,
  yMax,
  sensitivity,
  onWheelChange,
  onWheelChangeEnd,
  onYChange,
  onYChangeEnd,
  onReset,
}: {
  label: string;
  r: number;
  g: number;
  b: number;
  y: number;
  yMin: number;
  yMax: number;
  sensitivity: number;
  onWheelChange: (r: number, g: number, b: number) => void;
  onWheelChangeEnd: (r: number, g: number, b: number) => void;
  onYChange: (v: number) => void;
  onYChangeEnd: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col">
      {/* Header: section label + reset */}
      <div className="flex items-center justify-between mb-4">
        <span className="label">{label}</span>
        <button
          onClick={onReset}
          className="flex items-center justify-center transition-colors"
          style={{
            width: 28,
            height: 28,
            border: "1px solid var(--line)",
            background: "var(--card)",
            color: "var(--mid)",
            transitionDuration: "80ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--card-hi)";
            e.currentTarget.style.color = "var(--ink)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--card)";
            e.currentTarget.style.color = "var(--mid)";
          }}
          title={`Reset ${label}`}
          aria-label={`Reset ${label} wheel`}
        >
          <RotateCcw style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Wheel + Y slider */}
      <div className="flex items-start gap-4 justify-center">
        <ColorWheel
          r={r}
          g={g}
          b={b}
          sensitivity={sensitivity}
          size={260}
          onChange={onWheelChange}
          onChangeEnd={onWheelChangeEnd}
          onReset={onReset}
        />
        <YSlider
          value={y}
          min={yMin}
          max={yMax}
          height={260}
          onChange={onYChange}
          onChangeEnd={onYChangeEnd}
        />
      </div>

      {/* RGB value boxes below */}
      <div className="grid grid-cols-3 gap-2 mt-5">
        <RGBBox letter="R" value={r + y} accent="var(--pgm)" />
        <RGBBox letter="G" value={g + y} accent="var(--pvw)" />
        <RGBBox letter="B" value={b + y} accent="var(--cyan)" />
      </div>
    </div>
  );
}

function RGBBox({
  letter,
  value,
  accent,
}: {
  letter: string;
  value: number;
  accent: string;
}) {
  const signed = value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        padding: "8px 0",
        border: "1px solid var(--line)",
        background: "var(--card)",
      }}
    >
      <span
        className="font-mono uppercase"
        style={{
          fontSize: 10,
          letterSpacing: "1.6px",
          fontWeight: 700,
          color: accent,
        }}
      >
        {letter}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
      >
        {signed}
      </span>
    </div>
  );
}
