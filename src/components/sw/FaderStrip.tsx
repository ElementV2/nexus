"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

/**
 * Tactical Refined channel fader (vMix scale).
 *
 *   [── track ──][meter][   0      ]   ← 0 dB at the very top
 *   [           ][     ][  -3      ]
 *   [   ▭▭▭▭   ][     ][  -6      ]   ← wide cap with grip line
 *   [           ][     ][ -12      ]
 *   [           ][   m][ -24      ]   ← ~middle of fader
 *   [           ][   m][ -48      ]
 *   [           ][   m][ -∞       ]
 *
 * vMix slider mapping is `dB = 80 * log10(slider/100)`, so the top of
 * the fader is 0 dB and there's no positive headroom. The track is
 * dragable; the cap moves with `level`. A thin clipped gradient bar
 * shows the live peak. Tick labels are optional.
 */
const DEFAULT_TICKS = [0, -3, -6, -12, -24, -48] as const;

function FaderStripImpl({
  level,
  meter = 0,
  meterRole = "green",
  muted = false,
  height = 240,
  ticks = DEFAULT_TICKS as readonly number[],
  onChange,
  onChangeStart,
  onChangeEnd,
  className,
}: {
  /** 0..1 — fader position */
  level: number;
  /** 0..1 — peak meter level */
  meter?: number;
  meterRole?: "green" | "red" | "amber";
  /** When true the meter fill renders cyan instead of the broadcast
      gradient — matches the rest of the app's "audio is silenced" cue. */
  muted?: boolean;
  height?: number;
  /** dB values to print as tick labels. Set to [] to hide. */
  ticks?: readonly number[];
  onChange?: (v: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: (v: number) => void;
  className?: string;
}) {
  // Broadcast sectorized gradient — green/amber/red
  const meterGradient =
    "linear-gradient(to top, var(--pvw) 0%, var(--pvw) 60%, var(--amber) 82%, var(--pgm) 100%)";
  const meterColor = muted
    ? "var(--cyan)"
    : meterRole === "red"
      ? "var(--pgm)"
      : meterRole === "amber"
        ? "var(--amber)"
        : meterGradient;

  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onChange) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let lastRatio = level;
    const update = (clientY: number) => {
      const rect = target.getBoundingClientRect();
      const ratio =
        1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      lastRatio = ratio;
      onChange(ratio);
    };
    onChangeStart?.();
    update(e.clientY);
    const move = (ev: PointerEvent) => update(ev.clientY);
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      onChangeEnd?.(lastRatio);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  // vMix scale — `dB = 80 * log10(slider/100)`, so the fader position
  // for a given dB is `slider/100 = 10^(dB/80)`. The top of the fader
  // is 0 dB; there's no positive headroom.
  const dbToY = (db: number) => {
    if (db >= 0) return 1;
    if (!isFinite(db)) return 0;
    return Math.pow(10, db / 80);
  };

  return (
    <div
      className={cn("flex items-stretch", className)}
      style={{ height, gap: 4 }}
    >
      {/* Fader track + cap */}
      <div
        onPointerDown={handlePointer}
        className="relative cursor-pointer touch-none"
        style={{
          width: 32,
          border: "1px solid var(--line)",
          background: "var(--card)",
        }}
      >
        {/* -24 dB reference line (mid-fader landmark) */}
        <div
          className="absolute left-0 right-0"
          style={{
            height: 1,
            top: "50%",
            background: "var(--line-hi)",
          }}
        />
        {/* Cap — wide horizontal block, 3 grip ticks for that broadcast
            console feel. Keeps it readable but never reads as flat 95-era
            white box. */}
        <div
          className="absolute flex flex-col items-center justify-center"
          style={{
            left: -3,
            right: -3,
            height: 14,
            gap: 2,
            background: "var(--ink)",
            border: "1px solid var(--bg)",
            bottom: `calc(${Math.min(100, level * 100)}% - 7px)`,
          }}
        >
          <span style={{ width: 14, height: 1, background: "var(--bg)" }} />
          <span style={{ width: 14, height: 1, background: "var(--bg)" }} />
          <span style={{ width: 14, height: 1, background: "var(--bg)" }} />
        </div>
      </div>

      {/* Meter — thin clipped gradient bar */}
      <div
        className="relative"
        style={{
          width: 6,
          border: "1px solid var(--line)",
          background: "var(--card)",
        }}
      >
        <div
          className="absolute left-0 right-0 bottom-0"
          style={{
            height: `${Math.min(100, meter * 100)}%`,
            background: meterColor,
            opacity: 0.9,
          }}
        />
      </div>

      {/* Tick labels */}
      {ticks.length > 0 && (
        <div className="relative" style={{ width: 26 }}>
          {ticks.map((db) => {
            const y = dbToY(db);
            return (
              <span
                key={db}
                className="absolute font-mono tabular-nums"
                style={{
                  right: 0,
                  top: `calc(${(1 - y) * 100}% - 5px)`,
                  fontSize: 9,
                  color: "var(--muted)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                {db > 0 ? `+${db}` : db}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const FaderStrip = memo(FaderStripImpl);
