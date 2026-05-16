"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Copy, Check } from "lucide-react";
import { copyToClipboard } from "@/lib/utils/clipboard";

/**
 * Four-step AbletonOSC install walkthrough. Designed to be rendered
 * either inline (in the empty/offline state of the Ableton page) or
 * inside a popover for users who want to re-read instructions.
 *
 * AbletonOSC has no tagged releases, so the download link points to the
 * GitHub-generated master zip — that's the URL the project's own README
 * advertises, so it's stable.
 */

const DOWNLOAD_URL =
  "https://github.com/ideoforms/AbletonOSC/archive/refs/heads/master.zip";

// Parent path — the User Library exists out of the box. Pasting this
// into Explorer / Finder always works, even if the user hasn't created
// the Remote Scripts subfolder yet (which Ableton doesn't ship with).
const WIN_PARENT = "%USERPROFILE%\\Documents\\Ableton\\User Library";
const MAC_PARENT = "~/Music/Ableton/User Library";
const WIN_FULL = `${WIN_PARENT}\\Remote Scripts`;
const MAC_FULL = `${MAC_PARENT}/Remote Scripts`;

type Os = "win" | "mac" | "other";

function detectOs(): Os {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "win";
  if (ua.includes("mac")) return "mac";
  return "other";
}

// useSyncExternalStore-friendly: a no-op subscribe (the value never
// changes after mount) and a server snapshot of "other" to avoid
// hydration mismatch. The client snapshot returns the real OS.
const subscribeNoop = () => () => {};
const useOs = (): Os =>
  useSyncExternalStore(
    subscribeNoop,
    () => detectOs(),
    () => "other"
  );

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      onClick={onCopy}
      className="font-mono uppercase transition-colors"
      style={{
        padding: "6px 12px",
        fontSize: 10,
        letterSpacing: "1.4px",
        background: copied ? "var(--pvw-tint)" : "var(--card)",
        color: copied ? "var(--pvw)" : "var(--mid)",
        border: `1px solid ${copied ? "var(--pvw)" : "var(--line-hi)"}`,
        transitionDuration: "80ms",
      }}
      title="Copy path"
    >
      <span className="inline-flex items-center" style={{ gap: 6 }}>
        {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function PathRow({
  label,
  parent,
  full,
  highlighted,
}: {
  label: string;
  parent: string;
  full: string;
  highlighted?: boolean;
}) {
  return (
    <div
      style={{
        padding: "12px",
        background: highlighted ? "var(--panel-2)" : "transparent",
        border: `1px solid ${highlighted ? "var(--line-hi)" : "var(--line)"}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="label">{label}</div>

      {/* Step a: open the parent — this always exists. */}
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <div className="min-w-0 flex-1">
          <div
            style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}
          >
            a. Open this folder in {label === "Windows" ? "Explorer" : "Finder"}
          </div>
          <div
            className="font-mono truncate"
            style={{
              fontSize: 11,
              color: highlighted ? "var(--ink)" : "var(--mid)",
            }}
            title={parent}
          >
            {parent}
          </div>
        </div>
        <CopyButton value={parent} />
      </div>

      {/* Step b: create the Remote Scripts subfolder if missing. */}
      <div
        style={{ fontSize: 11, color: "var(--mid)", paddingLeft: 0 }}
      >
        b. Create a new folder named{" "}
        <code style={{ color: "var(--amber)" }}>Remote Scripts</code> inside it
        (if it doesn&apos;t already exist).
      </div>

      {/* Step c: drop the AbletonOSC folder in there. */}
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <div className="min-w-0 flex-1">
          <div
            style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}
          >
            c. Move the AbletonOSC folder into this final path
          </div>
          <div
            className="font-mono truncate"
            style={{
              fontSize: 11,
              color: highlighted ? "var(--ink)" : "var(--mid)",
            }}
            title={full}
          >
            {full}
          </div>
        </div>
        <CopyButton value={full} />
      </div>
    </div>
  );
}

function Step({
  num,
  title,
  children,
}: {
  num: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div
        className="flex items-center justify-center font-mono shrink-0"
        style={{
          width: 22,
          height: 22,
          fontSize: 11,
          fontWeight: 700,
          background: "var(--card)",
          color: "var(--amber)",
          border: "1px solid var(--line-hi)",
        }}
      >
        {num}
      </div>
      <div className="flex-1 min-w-0">
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink)",
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--mid)", lineHeight: 1.5 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function InstallGuide() {
  const os = useOs();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: 16,
        background: "var(--card)",
        border: "1px solid var(--line)",
      }}
    >
      <div>
        <div
          className="label"
          style={{ marginBottom: 4 }}
        >
          First time setup
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            marginBottom: 4,
          }}
        >
          Install AbletonOSC
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          Requires Ableton Live 11 or higher.
        </div>
      </div>

      <Step num={1} title="Download the script">
        <div style={{ marginBottom: 8 }}>
          Get the latest version from GitHub.
        </div>
        <a
          href={DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="font-mono uppercase transition-colors inline-flex items-center"
          style={{
            padding: "8px 14px",
            fontSize: 10,
            letterSpacing: "1.4px",
            gap: 8,
            background: "var(--amber-tint)",
            color: "var(--amber)",
            border: "1px solid var(--amber)",
            textDecoration: "none",
            transitionDuration: "80ms",
          }}
        >
          <Download size={12} strokeWidth={1.5} />
          Download zip
        </a>
      </Step>

      <Step num={2} title="Unzip and rename the folder">
        <div>
          After extracting, rename the folder{" "}
          <code style={{ color: "var(--ink)" }}>AbletonOSC-master</code> to{" "}
          <code style={{ color: "var(--ink)" }}>AbletonOSC</code> (drop the
          <code style={{ color: "var(--ink)" }}>-master</code> suffix).
        </div>
      </Step>

      <Step num={3} title="Create the Remote Scripts folder, then drop AbletonOSC in it">
        <div style={{ marginBottom: 10 }}>
          Ableton doesn&apos;t ship with a{" "}
          <code style={{ color: "var(--ink)" }}>Remote Scripts</code> folder —
          you create one yourself inside the User Library.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <PathRow
            label="Windows"
            parent={WIN_PARENT}
            full={WIN_FULL}
            highlighted={os === "win"}
          />
          <PathRow
            label="macOS"
            parent={MAC_PARENT}
            full={MAC_FULL}
            highlighted={os === "mac"}
          />
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "var(--muted)",
            paddingLeft: 0,
          }}
        >
          Tip: paste the first path into the Explorer / Finder address bar to
          jump straight to the User Library.
        </div>
      </Step>

      <Step num={4} title="Enable it in Ableton">
        <div>
          Restart Live, then go to{" "}
          <span style={{ color: "var(--ink)" }}>
            Options → Settings → Tempo &amp; MIDI
          </span>
          . In the{" "}
          <span style={{ color: "var(--ink)" }}>Control Surface</span>{" "}
          dropdown, select{" "}
          <span style={{ color: "var(--ink)" }}>AbletonOSC</span>. Live will
          confirm with{" "}
          <span className="font-mono" style={{ fontSize: 11 }}>
            &quot;AbletonOSC: Listening for OSC on port 11000&quot;
          </span>
          .
        </div>
      </Step>
    </div>
  );
}
