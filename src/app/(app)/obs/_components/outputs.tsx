"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Radio,
  Disc,
  Repeat,
  Camera,
  Scissors,
  Bookmark,
  Activity,
} from "lucide-react";
import { useObsStore } from "@/stores/obs-store";
import { useObsCommand } from "@/hooks/use-obs-command";
import type { ObsStats } from "@/lib/obs/types";
import {
  Section,
  Eyebrow,
  HairlineRow,
  StatusPill,
  MonoChip,
  Stat,
} from "@/components/sw";
import { formatDuration, formatBytes } from "./format";

/* ── Output controls: stream / record / replay / vcam ────────── */

export function OutputsBar() {
  const stream = useObsStore((s) => s.snapshot?.stream);
  const record = useObsStore((s) => s.snapshot?.record);
  const replayBuffer = useObsStore((s) => s.snapshot?.replayBuffer);
  const virtualCam = useObsStore((s) => s.snapshot?.virtualCam);
  const send = useObsCommand();
  if (!stream || !record || !replayBuffer || !virtualCam) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        padding: "12px",
        background: "var(--bg)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <OutputCard
        title="Stream"
        icon={<Radio size={14} />}
        active={stream.active}
        sub={
          stream.active
            ? `${formatDuration(stream.timecodeMs)} · ${formatBytes(stream.bytesSent)}`
            : "idle"
        }
        warn={stream.reconnecting}
        primaryLabel={stream.active ? "Stop" : "Start"}
        onPrimary={() => send({ action: "toggle-stream" })}
        secondary={null}
      />
      <OutputCard
        title="Record"
        icon={<Disc size={14} />}
        active={record.active}
        paused={record.paused}
        sub={
          record.active
            ? `${formatDuration(record.timecodeMs)} · ${formatBytes(record.bytes)}`
            : "idle"
        }
        primaryLabel={record.active ? "Stop" : "Start"}
        onPrimary={() => send({ action: "toggle-record" })}
        secondary={
          record.active
            ? {
                label: record.paused ? "Resume" : "Pause",
                onClick: () =>
                  send({
                    action: record.paused ? "resume-record" : "pause-record",
                  }),
              }
            : null
        }
      />
      <OutputCard
        title="Replay"
        icon={<Repeat size={14} />}
        active={replayBuffer.active}
        sub={replayBuffer.active ? "buffering" : "idle"}
        primaryLabel={replayBuffer.active ? "Stop" : "Start"}
        onPrimary={() => send({ action: "toggle-replay-buffer" })}
        secondary={
          replayBuffer.active
            ? {
                label: "Save",
                onClick: () => send({ action: "save-replay-buffer" }),
              }
            : null
        }
      />
      <OutputCard
        title="V-Cam"
        icon={<Camera size={14} />}
        active={virtualCam.active}
        sub={virtualCam.active ? "live" : "idle"}
        primaryLabel={virtualCam.active ? "Stop" : "Start"}
        onPrimary={() => send({ action: "toggle-virtual-cam" })}
        secondary={null}
      />
    </div>
  );
}

function OutputCard({
  title,
  icon,
  active,
  paused,
  warn,
  sub,
  primaryLabel,
  onPrimary,
  secondary,
}: {
  title: string;
  icon: React.ReactNode;
  active: boolean;
  paused?: boolean;
  warn?: boolean;
  sub: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondary: { label: string; onClick: () => void } | null;
}) {
  const role: "red" | "amber" | "muted" = warn
    ? "amber"
    : paused
      ? "amber"
      : active
        ? "red"
        : "muted";
  return (
    <div
      style={{
        flex: "1 1 220px",
        minWidth: 200,
        background: "var(--card)",
        border: "1px solid var(--line)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <span style={{ color: "var(--mid)" }}>{icon}</span>
        <span
          className="font-mono uppercase"
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "1.4px",
            color: "var(--ink)",
          }}
        >
          {title}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <StatusPill role={role} variant={active ? "solid" : undefined}>
            {paused ? "PAUSE" : active ? "ON" : "OFF"}
          </StatusPill>
        </span>
      </div>
      <div className="font-mono" style={{ fontSize: 11, color: "var(--muted)" }}>
        {sub}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={onPrimary}
          className="font-mono uppercase"
          style={{
            flex: 1,
            padding: "6px 10px",
            fontSize: 10,
            letterSpacing: "1.4px",
            fontWeight: 700,
            background: active ? "var(--pgm-tint)" : "var(--amber-tint)",
            color: active ? "var(--pgm)" : "var(--amber)",
            border: `1px solid ${active ? "var(--pgm)" : "var(--amber)"}`,
            cursor: "pointer",
          }}
        >
          {primaryLabel}
        </button>
        {secondary && (
          <button
            onClick={secondary.onClick}
            className="font-mono uppercase"
            style={{
              padding: "6px 10px",
              fontSize: 10,
              letterSpacing: "1.4px",
              fontWeight: 700,
              background: "var(--card)",
              color: "var(--mid)",
              border: "1px solid var(--line-hi)",
              cursor: "pointer",
            }}
          >
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Stream caption + record extras ─────────────────────────── */

export function ExtrasBar() {
  const stream = useObsStore((s) => s.snapshot?.stream);
  const record = useObsStore((s) => s.snapshot?.record);
  const send = useObsCommand();
  const [caption, setCaption] = useState("");
  const [recordDir, setRecordDir] = useState<string | null>(null);

  // Fetch the record directory once on mount — it doesn't push an
  // event, so we sync explicitly. Re-fetch when record starts so a
  // freshly configured profile is reflected.
  useEffect(() => {
    let cancelled = false;
    send({ action: "get-record-directory" }).then((r) => {
      if (
        !cancelled &&
        r.ok &&
        r.data &&
        typeof r.data === "object" &&
        "recordDirectory" in r.data
      ) {
        setRecordDir((r.data as { recordDirectory: string }).recordDirectory);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [send, record?.active]);

  return (
    <Section>
      <Eyebrow tone="amber" className="mb-3">
        Stream caption · Record file
      </Eyebrow>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {/* ── Caption ── */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <Eyebrow tone="muted">Live caption</Eyebrow>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={
                stream?.active
                  ? "type a caption then Send"
                  : "stream offline — captions only land while streaming"
              }
              className="font-mono"
              style={{
                flex: 1,
                padding: "4px 6px",
                fontSize: 11,
                background: "var(--bg)",
                color: "var(--ink)",
                border: "1px solid var(--line-hi)",
              }}
            />
            <button
              onClick={() => {
                if (!caption.trim() || !stream?.active) return;
                send({ action: "send-caption", text: caption });
                setCaption("");
              }}
              className="font-mono uppercase"
              style={{
                padding: "4px 10px",
                fontSize: 10,
                letterSpacing: "1.4px",
                fontWeight: 700,
                background: stream?.active ? "var(--amber)" : "var(--card)",
                color: stream?.active ? "var(--bg)" : "var(--sub)",
                border: `1px solid ${
                  stream?.active ? "var(--amber)" : "var(--line-hi)"
                }`,
                cursor: stream?.active ? "pointer" : "not-allowed",
              }}
            >
              Send
            </button>
          </div>
        </div>

        {/* ── Record split + chapter ── */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--line)",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <Eyebrow tone="muted">Record file</Eyebrow>
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: "var(--sub)",
              wordBreak: "break-all",
            }}
            title={recordDir ?? undefined}
          >
            {recordDir ?? "loading…"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => send({ action: "split-record-file" })}
              disabled={!record?.active}
              className="font-mono uppercase"
              style={{
                padding: "4px 10px",
                fontSize: 10,
                letterSpacing: "1.4px",
                fontWeight: 700,
                background: record?.active ? "var(--card)" : "var(--panel-2)",
                color: record?.active ? "var(--mid)" : "var(--sub)",
                border: "1px solid var(--line-hi)",
                cursor: record?.active ? "pointer" : "not-allowed",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              title="Split the current recording into a new file (MKV/MP4 hybrid)."
            >
              <Scissors size={12} /> Split
            </button>
            <button
              onClick={() =>
                send({
                  action: "create-record-chapter",
                  chapterName: new Date().toISOString().slice(11, 19),
                })
              }
              disabled={!record?.active}
              className="font-mono uppercase"
              style={{
                padding: "4px 10px",
                fontSize: 10,
                letterSpacing: "1.4px",
                fontWeight: 700,
                background: record?.active ? "var(--card)" : "var(--panel-2)",
                color: record?.active ? "var(--mid)" : "var(--sub)",
                border: "1px solid var(--line-hi)",
                cursor: record?.active ? "pointer" : "not-allowed",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              title="Insert a chapter marker (MKV only)."
            >
              <Bookmark size={12} /> Chapter
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── Outputs (custom: NDI, custom record, ...) ───────────────── */

interface OutputInfo {
  outputName: string;
  outputKind: string;
  outputActive: boolean;
}

export function OutputsCustomPanel() {
  const [outputs, setOutputs] = useState<OutputInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const send = useObsCommand();

  const refresh = useCallback(async () => {
    const r = await send({ action: "get-output-list" });
    if (
      r.ok &&
      r.data &&
      typeof r.data === "object" &&
      "outputs" in r.data
    ) {
      setOutputs((r.data as { outputs: OutputInfo[] }).outputs);
    }
  }, [send]);

  // The toggle button below fires `refresh()` directly when opening,
  // and toggle-output handlers refresh after a change. No effect-based
  // sync needed — keeps us out of the cascading-render trap.

  return (
    <Section>
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) refresh();
        }}
        className="font-mono uppercase"
        style={{
          padding: "6px 10px",
          fontSize: 10,
          letterSpacing: "1.4px",
          fontWeight: 700,
          background: open ? "var(--amber-tint)" : "var(--card)",
          color: open ? "var(--amber)" : "var(--mid)",
          border: `1px solid ${open ? "var(--amber)" : "var(--line-hi)"}`,
          cursor: "pointer",
        }}
      >
        {open ? "▼" : "▶"} Outputs (advanced)
      </button>
      {open && outputs && (
        <div style={{ marginTop: 12 }}>
          {outputs.length === 0 && (
            <div className="text-[12px] text-sw-muted">No outputs.</div>
          )}
          {outputs.map((o) => (
            <HairlineRow key={o.outputName} className="flex items-center">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-baseline" style={{ gap: 8 }}>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    {o.outputName}
                  </span>
                  <MonoChip>{o.outputKind}</MonoChip>
                  <StatusPill
                    role={o.outputActive ? "red" : "muted"}
                    variant={o.outputActive ? "solid" : undefined}
                  >
                    {o.outputActive ? "ON" : "OFF"}
                  </StatusPill>
                </div>
              </div>
              <button
                onClick={async () => {
                  await send({
                    action: "toggle-output",
                    outputName: o.outputName,
                  });
                  refresh();
                }}
                className="font-mono uppercase"
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  letterSpacing: "1.4px",
                  fontWeight: 700,
                  background: o.outputActive
                    ? "var(--pgm-tint)"
                    : "var(--amber-tint)",
                  color: o.outputActive ? "var(--pgm)" : "var(--amber)",
                  border: `1px solid ${
                    o.outputActive ? "var(--pgm)" : "var(--amber)"
                  }`,
                  cursor: "pointer",
                }}
              >
                {o.outputActive ? "Stop" : "Start"}
              </button>
            </HairlineRow>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ── Stats footer ────────────────────────────────────────────── */

export function StatsFooter({ stats }: { stats: ObsStats | null }) {
  if (!stats) return null;
  // OBS can return null/undefined for individual stat fields (e.g. cpuUsage
  // on the very first GetStats, before it has a sampling window) even though
  // the type says `number`. Coerce per-field so a single missing value never
  // crashes the whole page on `.toFixed()`.
  const n = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        padding: "8px 16px",
        background: "var(--panel)",
        borderTop: "1px solid var(--line)",
        alignItems: "center",
      }}
    >
      <Activity size={14} color="var(--mid)" />
      <Stat label="CPU" value={`${n(stats.cpuUsage).toFixed(1)} %`} />
      <Stat label="FPS" value={n(stats.activeFps).toFixed(1)} />
      <Stat
        label="Render"
        value={`${n(stats.averageFrameRenderTime).toFixed(2)} ms`}
      />
      <Stat
        label="Skipped (render)"
        value={`${n(stats.renderSkippedFrames)}/${n(stats.renderTotalFrames)}`}
      />
      <Stat
        label="Skipped (output)"
        value={`${n(stats.outputSkippedFrames)}/${n(stats.outputTotalFrames)}`}
      />
      <Stat label="Mem" value={`${n(stats.memoryUsage).toFixed(0)} MB`} />
      <Stat
        label="Disk"
        value={`${n(stats.availableDiskSpace).toFixed(0)} GB`}
      />
    </div>
  );
}
