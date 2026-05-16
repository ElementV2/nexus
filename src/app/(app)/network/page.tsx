"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useVmixStore } from "@/stores/vmix-store";
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
}

interface ScanData {
  hosts: ScannedHost[];
  subnet: string;
  publicIP?: string;
}

const PORT_LABELS: Record<number, string> = {
  22: "SSH", 80: "HTTP", 443: "HTTPS", 445: "SMB",
  548: "AFP", 554: "RTSP", 3389: "RDP", 8088: "vMix",
  8080: "HTTP", 9100: "Print", 62078: "iOS",
};

function deviceTypeLabel(h: ScannedHost): string {
  if (h.isVmix) return "vMix";
  const p = h.openPorts;
  if (p.includes(62078)) return "iPhone / iPad";
  if (p.includes(554)) return "Camera / RTSP";
  if (p.includes(9100)) return "Printer";
  if (p.includes(548)) return "Mac";
  if (p.includes(3389) && p.includes(445)) return "Windows PC";
  if (p.includes(3389)) return "Windows";
  if (p.includes(445)) return "Windows / NAS";
  if (p.includes(22) && p.includes(80)) return "Linux / Server";
  if (p.includes(22)) return "Linux";
  if (p.includes(80) || p.includes(443) || p.includes(8080)) return "Web Device";
  return "Device";
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
  const otherHosts = hosts.filter((h) => !h.isVmix);

  async function connectVmix(ip: string) {
    if (connected && currentHost === ip) {
      router.push("/dashboard");
      return;
    }
    setVmixConnecting(ip);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vmix_host: ip, vmix_port: currentPort }),
      });
      if (!res.ok) throw new Error("Failed to save preferences");
      setConnectionInfo(ip, currentPort, currentSrtPort);
      router.push("/dashboard");
    } catch {
      setVmixConnecting(null);
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

      {/* Scan results */}
      {hosts.length > 0 && (
        <>
          {vmixHosts.length > 0 && (
            <>
              <div className="px-[24px] pt-[14px] pb-[8px] border-b-[1px] border-sw-line">
                <Eyebrow tone="amber">vMix instances</Eyebrow>
              </div>
              {vmixHosts.map((h) => {
                const isCurrent = connected && currentHost === h.ip;
                return (
                  <HairlineRow
                    key={h.ip}
                    state={isCurrent ? "pgm" : "default"}
                    className="flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span className="font-mono text-[15px] font-bold text-sw-text">
                          {h.ip}
                        </span>
                        <StatusPill role="red" variant="solid">vMix</StatusPill>
                        {h.vmixVersion && (
                          <MonoChip>v{h.vmixVersion}</MonoChip>
                        )}
                        {h.vmixEdition && (
                          <MonoChip>{h.vmixEdition}</MonoChip>
                        )}
                      </div>
                      <div className="flex gap-3 mt-1 text-[10px] text-sw-muted">
                        {h.hostname && <span className="truncate max-w-[240px]">{h.hostname}</span>}
                        {h.vendor && <span>{h.vendor}</span>}
                        {h.mac && <span className="font-mono">{h.mac}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => connectVmix(h.ip)}
                      disabled={vmixConnecting === h.ip}
                      className="font-mono uppercase transition-colors"
                      style={{
                        padding: "8px 16px",
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "1.4px",
                        background: isCurrent
                          ? "var(--pvw-tint)"
                          : "var(--pgm-tint)",
                        color: isCurrent ? "var(--pvw)" : "var(--pgm)",
                        border: `1px solid ${
                          isCurrent ? "var(--pvw)" : "var(--pgm)"
                        }`,
                        opacity: vmixConnecting === h.ip ? 0.5 : 1,
                        cursor:
                          vmixConnecting === h.ip ? "wait" : "pointer",
                        transitionDuration: "80ms",
                      }}
                    >
                      {vmixConnecting === h.ip
                        ? "Connecting…"
                        : isCurrent
                          ? "Active →"
                          : "Connect →"}
                    </button>
                  </HairlineRow>
                );
              })}
            </>
          )}

          {otherHosts.length > 0 && (
            <>
              <div className="px-[24px] pt-[14px] pb-[8px] border-b-[1px] border-sw-line">
                <Eyebrow tone="muted">Other devices</Eyebrow>
              </div>
              {otherHosts.map((h) => {
                const label = deviceTypeLabel(h);
                return (
                  <HairlineRow key={h.ip} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span className="font-mono text-[13px] text-sw-text-dim">{h.ip}</span>
                        <span className="text-[11px] text-sw-muted">{label}</span>
                      </div>
                      <div className="flex gap-3 mt-1 text-[10px] text-sw-sub">
                        {h.hostname && <span className="truncate max-w-[240px]">{h.hostname}</span>}
                        {h.vendor && <span>{h.vendor}</span>}
                        {h.mac && <span className="font-mono">{h.mac}</span>}
                        {h.openPorts.length > 0 && (
                          <span className="font-mono">
                            tcp:{" "}
                            {h.openPorts
                              .map((p) => `${p}${PORT_LABELS[p] ? `(${PORT_LABELS[p]})` : ""}`)
                              .join(" · ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </HairlineRow>
                );
              })}
            </>
          )}
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
          <a href="/api/network/script" download="vmix-scanner.bat">
            <PrimaryButton>↓ vmix-scanner.bat</PrimaryButton>
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
              Double-click <span className="font-mono text-sw-text-dim">vmix-scanner.bat</span> on the control PC.
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
