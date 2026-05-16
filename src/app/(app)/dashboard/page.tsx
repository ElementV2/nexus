"use client";

import Link from "next/link";
import { useVmixStore } from "@/stores/vmix-store";
import {
  TopBar,
  Section,
  Eyebrow,
  StatusPill,
  Stat,
  ToolbarSlot,
} from "@/components/sw";

const MODULES = [
  { num: "02", title: "Live",     description: "PGM / PVW switching & tally",   href: "/live" },
  { num: "03", title: "Audio",    description: "VU meters, faders, routing",     href: "/audio" },
  { num: "04", title: "Color",    description: "Lift, Gamma, Gain corrections",  href: "/colorimetry" },
  { num: "05", title: "Playlist", description: "Transport controls & routing",   href: "/playlist" },
  { num: "06", title: "Titles",   description: "Text fields & countdowns",       href: "/titles" },
  { num: "07", title: "Replay",   description: "Instant replay & events",        href: "/replay" },
  { num: "08", title: "Assets",   description: "Overlay editor & templates",     href: "/web-assets" },
  { num: "09", title: "Network",  description: "Subnet scanner & discovery",     href: "/network", alwaysOn: true },
  { num: "10", title: "Debug",    description: "Raw vMix state inspector",       href: "/debug-xml" },
];

export default function DashboardHomePage() {
  // Granular selectors — the dashboard only reads top-level primitives.
  // Subscribing to the full vmixState object would re-render this page on
  // every poll tick (~150 ms) even though none of the displayed values
  // actually change between ticks unless the user starts/stops a recording
  // or adds an input.
  const connected = useVmixStore((s) => s.connected);
  const version = useVmixStore((s) => s.vmixState?.version ?? null);
  const edition = useVmixStore((s) => s.vmixState?.edition ?? null);
  const recording = useVmixStore((s) => s.vmixState?.recording ?? false);
  const streaming = useVmixStore((s) => s.vmixState?.streaming ?? false);
  const inputCount = useVmixStore((s) => s.vmixState?.inputs?.length ?? 0);
  const pollingInterval = useVmixStore((s) => s.pollingInterval);

  const versionLabel =
    version && edition ? `${version} · ${edition}` : "no vmix detected";

  // The visible REC / LIVE pills are unchanged; the polite live
  // region next to them (in the right slot) announces start / stop
  // transitions so screen-reader users don't miss state changes.
  const recordingPill = recording ? (
    <StatusPill role="amber" glyph="●">
      REC
    </StatusPill>
  ) : null;

  const streamingPill = streaming ? (
    <StatusPill role="red" glyph="●" variant="solid">
      LIVE
    </StatusPill>
  ) : null;

  return (
    <div className="flex flex-col">
      <TopBar
        status={connected ? "live" : "offline"}
        num="01"
        label="Control surfaces"
        title={
          <>
            {MODULES.length}{" "}
            <span className="text-sw-muted font-light">modules.</span>
          </>
        }
        sub={versionLabel}
        right={
          <>
            {recording && <ToolbarSlot label="Record">{recordingPill}</ToolbarSlot>}
            {streaming && <ToolbarSlot label="Stream">{streamingPill}</ToolbarSlot>}
            {/* Off-screen siblings that stay mounted so the live region
                can announce stop transitions even when the visible
                ToolbarSlot has unmounted. */}
            <span
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
              }}
            >
              <span role="status" aria-live="polite">
                {recording ? "Recording started" : ""}
              </span>
              <span role="status" aria-live="polite">
                {streaming ? "Streaming started" : ""}
              </span>
            </span>
          </>
        }
      />

      <Section pad={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 pr-px pb-px">
          {MODULES.map((mod) => {
            const disabled = !connected && !mod.alwaysOn;
            return (
              <ModuleCell
                key={mod.href}
                href={mod.href}
                num={mod.num}
                title={mod.title}
                description={mod.description}
                disabled={disabled}
              />
            );
          })}
        </div>
      </Section>

      {/* Connection summary */}
      <Section>
        <Eyebrow tone="muted" className="mb-4">02 — Connection</Eyebrow>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
          <Stat
            label="vMix"
            value={version ?? "—"}
            sub={connected ? "online" : "no connection"}
          />
          <Stat
            label="Edition"
            value={<span className="text-[18px]">{edition ?? "—"}</span>}
            sub="installed"
          />
          <Stat
            label="Inputs"
            value={inputCount}
            sub="sources loaded"
          />
          <Stat
            label="Polling"
            value={
              <span className="text-[18px]">
                {pollingInterval}
                <span className="text-sw-muted text-[12px] ml-1">ms</span>
              </span>
            }
            sub="server interval"
          />
        </div>
      </Section>
    </div>
  );
}

function ModuleCell({
  href,
  num,
  title,
  description,
  disabled,
}: {
  href: string;
  num: string;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <span className="label">{num}</span>
        {!disabled && (
          <span style={{ color: "var(--amber)", fontSize: 13, fontWeight: 700 }}>
            ↗
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--ink)",
          letterSpacing: "-0.01em",
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 4,
          lineHeight: 1.4,
        }}
      >
        {description}
      </div>
    </>
  );

  const sharedStyle: React.CSSProperties = {
    background: "var(--card)",
    border: "1px solid var(--line)",
    padding: "14px 16px",
    marginRight: -1,
    marginBottom: -1,
    transition: "background 80ms ease, border-color 80ms ease",
    opacity: disabled ? 0.3 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };

  if (disabled) return <div style={sharedStyle}>{inner}</div>;
  return (
    <Link
      href={href}
      style={sharedStyle}
      className="block"
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--card-hi)";
        e.currentTarget.style.borderColor = "var(--line-hi)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--card)";
        e.currentTarget.style.borderColor = "var(--line)";
      }}
    >
      {inner}
    </Link>
  );
}
