"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useVmixStore } from "@/stores/vmix-store";
import { useConnections } from "@/hooks/use-connections";
import {
  TopBar,
  Section,
  Eyebrow,
  HairlineRow,
  StatusPill,
  MonoChip,
  PrimaryButton,
  SecondaryButton,
  ToolbarSlot,
} from "@/components/sw";
import { ConnectionsPanel } from "@/components/connections/connections-panel";

interface ScannedHost {
  ip: string;
  hostname: string;
  mac: string;
  vendor: string;
  openPorts: number[];
  vmixVersion: string;
  vmixEdition: string;
  isVmix: boolean;
  isObs?: boolean;
  obsWebSocketVersion?: string;
}

interface ScanData {
  hosts: ScannedHost[];
  subnet: string;
  publicIP?: string;
}

const PORT_LABELS: Record<number, string> = {
  22: "SSH", 80: "HTTP", 443: "HTTPS", 445: "SMB",
  548: "AFP", 554: "RTSP", 3389: "RDP", 4455: "OBS-WS",
  8088: "vMix", 8080: "HTTP", 9100: "Print", 62078: "iOS",
  // Console + lighting OSC. The TCP-port test in the scanner only
  // tells us "something's listening" — there's no protocol handshake
  // so we can't auto-detect X32 vs MA3 vs another OSC peer. The
  // `+ Add connection` flow in the connections panel covers the
  // manual case; these labels just give the operator a hint.
  8000: "OSC / MA2",
  9000: "OSC / MA3",
  10023: "OSC / X32",
};

/**
 * Classify a discovered host into a device category so the unified
 * list can badge every machine — not just vMix. vMix and OBS are
 * confirmed via an actual protocol handshake in the scanner; the rest
 * are best-effort guesses from open TCP ports (an OSC control port
 * open = "probably this console"). The operator finishes wiring any
 * non-auto-detected device through the connections panel above.
 */
type DeviceCat =
  | "vmix"
  | "obs"
  | "x32"
  | "grandma"
  | "ios"
  | "camera"
  | "printer"
  | "mac"
  | "windows"
  | "linux"
  | "web"
  | "device";

interface DeviceClass {
  cat: DeviceCat;
  label: string;
  /** Whether this category has a one-click connect action wired. */
  connectable: "vmix" | "obs" | null;
}

function classifyHost(h: ScannedHost): DeviceClass {
  if (h.isVmix) return { cat: "vmix", label: "vMix", connectable: "vmix" };
  if (h.isObs) return { cat: "obs", label: "OBS", connectable: "obs" };
  const p = h.openPorts;
  if (p.includes(10023)) return { cat: "x32", label: "X32 / M32 (OSC)", connectable: null };
  if (p.includes(9000)) return { cat: "grandma", label: "grandMA3 (OSC?)", connectable: null };
  if (p.includes(8000)) return { cat: "grandma", label: "grandMA2 (OSC?)", connectable: null };
  if (p.includes(62078)) return { cat: "ios", label: "iPhone / iPad", connectable: null };
  if (p.includes(554)) return { cat: "camera", label: "Camera / RTSP", connectable: null };
  if (p.includes(9100)) return { cat: "printer", label: "Printer", connectable: null };
  if (p.includes(548)) return { cat: "mac", label: "Mac", connectable: null };
  if (p.includes(3389) && p.includes(445)) return { cat: "windows", label: "Windows PC", connectable: null };
  if (p.includes(3389)) return { cat: "windows", label: "Windows", connectable: null };
  if (p.includes(445)) return { cat: "windows", label: "Windows / NAS", connectable: null };
  if (p.includes(22) && p.includes(80)) return { cat: "linux", label: "Linux / Server", connectable: null };
  if (p.includes(22)) return { cat: "linux", label: "Linux", connectable: null };
  if (p.includes(80) || p.includes(443) || p.includes(8080)) return { cat: "web", label: "Web device", connectable: null };
  return { cat: "device", label: "Device", connectable: null };
}

/** Pill role per category — AV gear gets loud colours, infra stays muted. */
function catPill(cat: DeviceCat): {
  role: "red" | "green" | "amber" | "blue" | "purple" | "muted";
  solid: boolean;
} {
  switch (cat) {
    case "vmix": return { role: "red", solid: true };
    case "obs": return { role: "green", solid: true };
    case "x32": return { role: "blue", solid: true };
    case "grandma": return { role: "amber", solid: true };
    case "camera": return { role: "purple", solid: false };
    case "ios":
    case "mac":
    case "windows":
    case "linux":
    case "web":
    case "printer":
    case "device":
    default: return { role: "muted", solid: false };
  }
}

/** Sort weight so AV gear floats to the top of the unified list. */
function catWeight(cat: DeviceCat): number {
  const order: DeviceCat[] = [
    "vmix", "obs", "x32", "grandma", "camera",
    "ios", "mac", "windows", "linux", "web", "printer", "device",
  ];
  const i = order.indexOf(cat);
  return i < 0 ? 99 : i;
}

export default function NetworkPageWrapper() {
  return (
    <Suspense fallback={null}>
      <NetworkPage />
    </Suspense>
  );
}

function NetworkPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [vmixConnecting, setVmixConnecting] = useState<string | null>(null);
  const [scanData, setScanData] = useState<ScanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setConnectionInfo = useVmixStore((s) => s.setConnectionInfo);
  const connected = useVmixStore((s) => s.connected);
  const currentHost = useVmixStore((s) => s.vmixHost);
  const currentPort = useVmixStore((s) => s.vmixPort);
  const currentSrtPort = useVmixStore((s) => s.vmixSrtPort);
  const { data: connData, refresh: refreshConnections } = useConnections();

  // Point the DEFAULT connection of a kind at a freshly-discovered IP by
  // patching its registry config (the single source of truth) and saving the
  // connections list — no more flat `*_host` fields. Creates the connection
  // if none exists yet (e.g. a wiped registry).
  async function pointDefaultConnection(
    kind: string,
    ip: string,
    extra: Record<string, unknown>
  ): Promise<boolean> {
    const conns = connData?.connections ?? [];
    const defId = connData?.defaults?.[kind];
    const target =
      conns.find((c) => c.id === defId && c.kind === kind) ??
      conns.find((c) => c.kind === kind && c.enabled) ??
      conns.find((c) => c.kind === kind);
    const patched = target
      ? conns.map((c) =>
          c.id === target.id
            ? {
                ...c,
                config: {
                  ...((c.config as Record<string, unknown> | null) ?? {}),
                  host: ip,
                  ...extra,
                },
              }
            : c
        )
      : [
          ...conns,
          {
            id: crypto.randomUUID(),
            kind,
            label: kind === "vmix" ? "vMix" : kind === "obs" ? "OBS Studio" : kind,
            enabled: true,
            config: { host: ip, ...extra },
          },
        ];
    const res = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connections: patched }),
    });
    if (res.ok) refreshConnections();
    return res.ok;
  }

  const scanId = searchParams.get("scan");

  useEffect(() => {
    if (!scanId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/network/results?id=${encodeURIComponent(scanId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Scan not found");
        return res.json();
      })
      .then((data: ScanData) => {
        setScanData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [scanId]);

  const hosts = scanData?.hosts || [];
  const scannedSubnet = scanData?.subnet || null;
  const publicIP = scanData?.publicIP || null;
  const vmixHosts = hosts.filter((h) => h.isVmix);
  // One unified, classified list — every machine on the subnet, AV
  // gear first. This is a network scanner, not a vMix-only finder.
  const classified = hosts
    .map((h) => ({ host: h, dev: classifyHost(h) }))
    .sort((a, b) => {
      const w = catWeight(a.dev.cat) - catWeight(b.dev.cat);
      if (w !== 0) return w;
      // Then by last IP octet so rows are stable + readable.
      return (
        Number(a.host.ip.split(".").pop()) -
        Number(b.host.ip.split(".").pop())
      );
    });
  // Count of auto-detected AV devices for the summary chip.
  const avCount = classified.filter((c) =>
    ["vmix", "obs", "x32", "grandma"].includes(c.dev.cat)
  ).length;

  async function connectVmix(ip: string) {
    if (connected && currentHost === ip) {
      router.push("/live");
      return;
    }
    setVmixConnecting(ip);
    try {
      const ok = await pointDefaultConnection("vmix", ip, { port: currentPort });
      if (!ok) throw new Error("Failed to save preferences");
      setConnectionInfo(ip, currentPort, currentSrtPort);
      router.push("/live");
    } catch {
      setVmixConnecting(null);
    }
  }

  async function connectObs(ip: string) {
    try {
      const ok = await pointDefaultConnection("obs", ip, { port: 4455 });
      if (!ok) throw new Error("Failed to save preferences");
      router.push("/obs");
    } catch {
      /* surfaced via the OBS card */
    }
  }

  const summarySub = scannedSubnet
    ? `${hosts.length} devices · ${scannedSubnet}.0/24`
    : `${hosts.length} devices`;

  return (
    <div className="flex flex-col">
      <TopBar
        status={connected ? "live" : "offline"}
        num="09"
        label={hosts.length > 0 ? "Discovered hosts" : "Subnet scanner"}
        title={
          hosts.length > 0 ? (
            <>
              {hosts.length}{" "}
              <span className="text-sw-muted font-light">
                device{hosts.length !== 1 ? "s" : ""}.
              </span>
            </>
          ) : (
            <>Network.</>
          )
        }
        sub={hosts.length > 0 ? summarySub : "subnet scanner"}
        right={
          hosts.length > 0 ? (
            <>
              {vmixHosts.length > 0 && (
                <ToolbarSlot label="vMix">
                  <StatusPill role="red" glyph="●">
                    {vmixHosts.length}
                  </StatusPill>
                </ToolbarSlot>
              )}
              {publicIP && (
                <ToolbarSlot label="Public IP">
                  <span className="font-mono text-[12px] text-sw-green">
                    {publicIP}
                  </span>
                </ToolbarSlot>
              )}
            </>
          ) : undefined
        }
      />

      {/* Unified vMix + Ableton connection editor with recent-host
          chips. Saves auto-propagate to both brokers. */}
      <div
        style={{
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <div className="px-[24px] pt-[14px] pb-[4px]">
          <Eyebrow tone="amber">Connections</Eyebrow>
        </div>
        <ConnectionsPanel />
      </div>

      {/* Loading */}
      {loading && (
        <Section>
          <div className="text-[12px] text-sw-muted">Loading scan results…</div>
        </Section>
      )}

      {/* Error — pgm-tint banner (canonical error shape across the app). */}
      {error && (
        <Section>
          <div
            role="alert"
            style={{
              padding: "12px",
              background: "var(--pgm-tint)",
              color: "var(--pgm)",
              border: "1px solid var(--pgm)",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        </Section>
      )}

      {/* Scan results — one unified list of EVERY machine found on the
          subnet, AV gear (vMix / OBS / X32 / grandMA) sorted first with
          a one-click connect where we can. */}
      {hosts.length > 0 && (
        <>
          <div className="px-[24px] pt-[14px] pb-[8px] border-b-[1px] border-sw-line flex items-center gap-3">
            <Eyebrow tone="amber">Discovered devices</Eyebrow>
            <span className="text-[10px] text-sw-muted font-mono">
              {hosts.length} host{hosts.length !== 1 ? "s" : ""}
              {avCount > 0 ? ` · ${avCount} AV` : ""}
            </span>
          </div>
          {classified.map(({ host: h, dev }) => {
            const isCurrent =
              dev.cat === "vmix" && connected && currentHost === h.ip;
            const pill = catPill(dev.cat);
            const isAv = ["vmix", "obs", "x32", "grandma"].includes(dev.cat);
            return (
              <HairlineRow
                key={h.ip}
                state={isCurrent ? "pgm" : "default"}
                className="flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span
                      className={`font-mono font-bold ${
                        isAv ? "text-[15px] text-sw-text" : "text-[13px] text-sw-text-dim"
                      }`}
                    >
                      {h.ip}
                    </span>
                    <StatusPill
                      role={pill.role}
                      variant={pill.solid ? "solid" : undefined}
                    >
                      {dev.label}
                    </StatusPill>
                    {h.vmixVersion && <MonoChip>v{h.vmixVersion}</MonoChip>}
                    {h.vmixEdition && <MonoChip>{h.vmixEdition}</MonoChip>}
                    {h.obsWebSocketVersion && (
                      <MonoChip>ws {h.obsWebSocketVersion}</MonoChip>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1 text-[10px] text-sw-muted flex-wrap">
                    {h.hostname && (
                      <span className="truncate max-w-[240px]">{h.hostname}</span>
                    )}
                    {h.vendor && <span>{h.vendor}</span>}
                    {h.mac && <span className="font-mono">{h.mac}</span>}
                    {h.openPorts.length > 0 && (
                      <span className="font-mono">
                        tcp:{" "}
                        {h.openPorts
                          .map(
                            (p) =>
                              `${p}${PORT_LABELS[p] ? `(${PORT_LABELS[p]})` : ""}`
                          )
                          .join(" · ")}
                      </span>
                    )}
                  </div>
                </div>
                {dev.connectable === "vmix" && (
                  <button
                    onClick={() => connectVmix(h.ip)}
                    disabled={vmixConnecting === h.ip}
                    className="font-mono uppercase transition-colors"
                    style={{
                      padding: "8px 16px",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "1.4px",
                      background: isCurrent ? "var(--pvw-tint)" : "var(--pgm-tint)",
                      color: isCurrent ? "var(--pvw)" : "var(--pgm)",
                      border: `1px solid ${isCurrent ? "var(--pvw)" : "var(--pgm)"}`,
                      opacity: vmixConnecting === h.ip ? 0.5 : 1,
                      cursor: vmixConnecting === h.ip ? "wait" : "pointer",
                      transitionDuration: "80ms",
                    }}
                  >
                    {vmixConnecting === h.ip
                      ? "Connecting…"
                      : isCurrent
                        ? "Active →"
                        : "Connect →"}
                  </button>
                )}
                {dev.connectable === "obs" && (
                  <button
                    onClick={() => connectObs(h.ip)}
                    className="font-mono uppercase transition-colors"
                    style={{
                      padding: "8px 16px",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "1.4px",
                      background: "var(--pvw-tint)",
                      color: "var(--pvw)",
                      border: "1px solid var(--pvw)",
                      cursor: "pointer",
                      transitionDuration: "80ms",
                    }}
                  >
                    Connect →
                  </button>
                )}
              </HairlineRow>
            );
          })}
        </>
      )}

      {/* No results after scan */}
      {scanId && !loading && !error && hosts.length === 0 && (
        <Section>
          <div className="text-center py-12">
            <Eyebrow tone="muted" className="mb-3">No hosts</Eyebrow>
            <div className="text-[16px] text-sw-text-dim font-bold">
              No devices found{scannedSubnet ? ` on ${scannedSubnet}.0/24` : ""}.
            </div>
            <div className="text-[11px] text-sw-muted mt-2">
              Check the network and try again.
            </div>
          </div>
        </Section>
      )}

      {/* Download scanner */}
      <Section>
        <Eyebrow tone="amber" className="mb-3">
          10 / {hosts.length > 0 ? "Rescan network" : "Scan network"}
        </Eyebrow>
        <p className="text-[13px] text-sw-text-dim leading-relaxed mb-4 max-w-2xl">
          {hosts.length > 0
            ? "Download and run the script again to refresh results."
            : "Run this script on your control PC. It probes the local subnet and pushes the results back here automatically."}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <a href="/api/network/script" download="network-scanner.bat">
            <PrimaryButton>↓ network-scanner.bat</PrimaryButton>
          </a>
          {hosts.length === 0 && !scanId && (
            <SecondaryButton disabled>Waiting for first run…</SecondaryButton>
          )}
        </div>
        {hosts.length === 0 && !scanId && (
          <ol className="mt-6 space-y-2 text-[11px] text-sw-muted">
            <li>
              <span className="font-mono text-sw-text-dim mr-2">01</span>
              Download the file above.
            </li>
            <li>
              <span className="font-mono text-sw-text-dim mr-2">02</span>
              Double-click <span className="font-mono text-sw-text-dim">network-scanner.bat</span> on the control PC.
            </li>
            <li>
              <span className="font-mono text-sw-text-dim mr-2">03</span>
              Results appear here automatically.
            </li>
          </ol>
        )}
      </Section>
    </div>
  );
}
