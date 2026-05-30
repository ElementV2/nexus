"use client";

import { useEffect, useMemo, useState } from "react";
import { useObsStore } from "@/stores/obs-store";
import { useObsCommand } from "@/hooks/use-obs-command";
import { Section, Eyebrow } from "@/components/sw";

/* ── Audio mixer ─────────────────────────────────────────────── */

export function AudioMixer() {
  const audioByInput = useObsStore(
    (s) => s.snapshot?.audioByInput ?? {}
  );
  const entries = useMemo(
    () => Object.entries(audioByInput),
    [audioByInput]
  );
  const send = useObsCommand();

  // Subscribe to the 60 Hz volume-meter firehose only while the mixer
  // is mounted. Drop it on unmount so background tabs don't keep the
  // SSE pipe noisy. The broker re-identifies — cheap, atomic.
  useEffect(() => {
    send({ action: "set-meters-enabled", enabled: true });
    return () => {
      send({ action: "set-meters-enabled", enabled: false });
    };
  }, [send]);

  if (entries.length === 0) return null;

  return (
    <Section>
      <Eyebrow tone="amber" className="mb-3">
        Audio mixer
      </Eyebrow>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 8,
        }}
      >
        {entries.map(([name, a]) => (
          <AudioStrip key={name} input={a} />
        ))}
      </div>
    </Section>
  );
}

function AudioStrip({
  input,
}: {
  input: {
    inputName: string;
    muted: boolean;
    volume: number;
    volumeDb: number;
    balance: number;
    syncOffsetMs: number;
    monitorType: string;
  };
}) {
  const send = useObsCommand();
  const levels = useObsStore((s) => s.volumeLevels[input.inputName]);
  const [drag, setDrag] = useState<number | null>(null);
  const db = drag ?? input.volumeDb;
  // Map dB (-60..0..+6 typical) to slider 0..100. Clamp at -60 so the
  // user can't accidentally bury the fader to -100 (silence) when
  // dragging — they hit Mute for that.
  const sliderVal = Math.max(0, Math.min(100, ((db + 60) / 66) * 100));

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 11,
          color: "var(--ink)",
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={input.inputName}
      >
        {input.inputName}
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={sliderVal}
        onChange={(e) => {
          const v = Number(e.target.value);
          const newDb = (v / 100) * 66 - 60;
          setDrag(newDb);
          send({
            action: "set-volume",
            inputName: input.inputName,
            volumeDb: newDb,
          });
        }}
        onMouseUp={() => setDrag(null)}
        onTouchEnd={() => setDrag(null)}
        style={{ width: "100%" }}
      />
      {levels && levels.length > 0 && <VuMeter levels={levels} />}
      <div
        className="font-mono"
        style={{ fontSize: 10, color: "var(--mid)" }}
      >
        {db.toFixed(1)} dB · ({input.volume.toFixed(2)}×)
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={() =>
            send({ action: "toggle-mute", inputName: input.inputName })
          }
          className="font-mono uppercase"
          style={{
            flex: 1,
            padding: "4px 6px",
            fontSize: 9,
            letterSpacing: "1.4px",
            fontWeight: 700,
            background: input.muted ? "var(--pgm-tint)" : "var(--card)",
            color: input.muted ? "var(--pgm)" : "var(--mid)",
            border: `1px solid ${input.muted ? "var(--pgm)" : "var(--line-hi)"}`,
            cursor: "pointer",
          }}
        >
          {input.muted ? "Muted" : "Mute"}
        </button>
        <select
          value={input.monitorType}
          onChange={(e) =>
            send({
              action: "set-monitor-type",
              inputName: input.inputName,
              monitorType: e.target.value,
            })
          }
          className="font-mono"
          style={{
            flex: 1,
            padding: "4px 4px",
            fontSize: 9,
            background: "var(--card)",
            color: "var(--mid)",
            border: "1px solid var(--line-hi)",
          }}
          title="Monitor type"
        >
          <option value="OBS_MONITORING_TYPE_NONE">none</option>
          <option value="OBS_MONITORING_TYPE_MONITOR_ONLY">monitor</option>
          <option value="OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT">m+out</option>
        </select>
      </div>
    </div>
  );
}

/* ── VU meter (per-channel dB bars) ──────────────────────────── */

function VuMeter({
  levels,
}: {
  levels: Array<[number, number, number]>;
}) {
  // Map -60..0 dB → 0..100% width. Anything above 0 dB clips into the
  // amber/red top band so the operator can spot peaks at a glance.
  const toPct = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "2px 0",
      }}
      aria-hidden
    >
      {levels.map(([mag, peak], i) => {
        const magPct = toPct(mag);
        const peakPct = toPct(peak);
        return (
          <div
            key={i}
            style={{
              position: "relative",
              width: "100%",
              height: 4,
              background: "var(--bg)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${magPct}%`,
                background:
                  mag > -3
                    ? "var(--pgm)"
                    : mag > -12
                      ? "var(--amber)"
                      : "var(--pvw)",
                transition: "width 60ms linear",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${peakPct}%`,
                top: 0,
                bottom: 0,
                width: 1,
                background: "var(--ink)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
