"use client";

import { useEffect, useRef, useState } from "react";
import { useObsStore } from "@/stores/obs-store";
import { useObsCommand } from "@/hooks/use-obs-command";
import { Eyebrow, MonoChip } from "@/components/sw";

/* ── Header: studio mode + transitions + duration ─────────────── */

export function TopHeaderBar() {
  const studio = useObsStore((s) => s.snapshot?.studioModeEnabled ?? false);
  const transitions = useObsStore((s) => s.snapshot?.transitions ?? []);
  const current = useObsStore((s) => s.snapshot?.currentTransitionName ?? null);
  const duration = useObsStore(
    (s) => s.snapshot?.currentTransitionDuration ?? 300
  );
  const send = useObsCommand();

  const [durationDraft, setDurationDraft] = useState(String(duration));
  useEffect(() => {
    setDurationDraft(String(duration));
  }, [duration]);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "8px 12px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
        alignItems: "center",
      }}
    >
      <button
        onClick={() => send({ action: "set-studio-mode", enabled: !studio })}
        className="font-mono uppercase"
        style={{
          padding: "6px 12px",
          fontSize: 10,
          letterSpacing: "1.4px",
          fontWeight: 700,
          background: studio ? "var(--pvw-tint)" : "var(--card)",
          color: studio ? "var(--pvw)" : "var(--mid)",
          border: `1px solid ${studio ? "var(--pvw)" : "var(--line-hi)"}`,
          cursor: "pointer",
        }}
      >
        Studio Mode {studio ? "ON" : "OFF"}
      </button>

      {studio && (
        <>
          <button
            onClick={() => send({ action: "trigger-studio-transition" })}
            className="font-mono uppercase"
            style={{
              padding: "6px 12px",
              fontSize: 10,
              letterSpacing: "1.4px",
              fontWeight: 700,
              background: "var(--amber)",
              color: "var(--bg)",
              border: "1px solid var(--amber)",
              cursor: "pointer",
            }}
          >
            Transition →
          </button>
          <TBarSlider />
        </>
      )}

      <div style={{ flex: "0 0 auto", marginLeft: 8 }}>
        <Eyebrow tone="muted">Transition</Eyebrow>
      </div>
      <select
        value={current ?? ""}
        onChange={(e) =>
          send({ action: "set-current-transition", name: e.target.value })
        }
        className="font-mono"
        style={{
          padding: "4px 6px",
          fontSize: 11,
          background: "var(--card)",
          color: "var(--ink)",
          border: "1px solid var(--line-hi)",
        }}
      >
        {transitions.map((t) => (
          <option key={t.transitionName} value={t.transitionName}>
            {t.transitionName}
          </option>
        ))}
      </select>

      <div style={{ marginLeft: 6 }}>
        <Eyebrow tone="muted">Duration · ms</Eyebrow>
      </div>
      <input
        type="number"
        value={durationDraft}
        onChange={(e) => setDurationDraft(e.target.value)}
        onBlur={() => {
          const ms = parseInt(durationDraft, 10);
          if (Number.isFinite(ms) && ms !== duration && ms >= 0) {
            send({ action: "set-transition-duration", ms });
          }
        }}
        className="font-mono"
        style={{
          width: 70,
          padding: "4px 6px",
          fontSize: 11,
          background: "var(--card)",
          color: "var(--ink)",
          border: "1px solid var(--line-hi)",
        }}
      />
    </div>
  );
}

/* ── TBar slider (Studio Mode) ───────────────────────────────── */

function TBarSlider() {
  const [pos, setPos] = useState(0);
  const send = useObsCommand();
  const release = useRef(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginLeft: 8,
      }}
    >
      <Eyebrow tone="muted">T-Bar</Eyebrow>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(pos * 100)}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          setPos(v);
          release.current = false;
          send({ action: "set-tbar", position: v, release: false });
        }}
        onMouseUp={() => {
          // Release tells OBS to commit the transition + reset the bar.
          if (release.current) return;
          release.current = true;
          send({ action: "set-tbar", position: pos, release: true });
          // Snap UI back to 0 so the next pull starts fresh.
          setPos(0);
        }}
        onTouchEnd={() => {
          if (release.current) return;
          release.current = true;
          send({ action: "set-tbar", position: pos, release: true });
          setPos(0);
        }}
        style={{ width: 180 }}
        title="Drag to scrub the studio-mode transition. Release commits."
      />
      <span
        className="font-mono"
        style={{ fontSize: 10, color: "var(--mid)", width: 32 }}
      >
        {Math.round(pos * 100)}%
      </span>
    </div>
  );
}

/* ── Special inputs (Desktop1/2, Mic/Aux) ────────────────────── */

export function SpecialInputsRow() {
  const [special, setSpecial] = useState<Record<string, string | null> | null>(
    null
  );
  const send = useObsCommand();

  useEffect(() => {
    let cancelled = false;
    send({ action: "get-special-inputs" }).then((r) => {
      if (!cancelled && r.ok && r.data && typeof r.data === "object") {
        setSpecial(r.data as Record<string, string | null>);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [send]);

  if (!special) return null;
  const entries = Object.entries(special).filter(([, v]) => v);
  if (entries.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "6px 12px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <Eyebrow tone="muted">Special inputs</Eyebrow>
      {entries.map(([slot, name]) => (
        <MonoChip key={slot}>
          {slot}: {name}
        </MonoChip>
      ))}
    </div>
  );
}
