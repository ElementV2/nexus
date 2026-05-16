"use client";

import { useEffect, useState, useCallback } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { useAbletonStore } from "@/stores/ableton-store";
import { MonoInput, StatusPill } from "@/components/sw";
import { InstallGuide } from "@/components/ableton/install-guide";
import { HelpCircle } from "lucide-react";

/**
 * Unified host/port editor for both vMix and Ableton. Lives on the
 * Network page so connection setup has a single canonical home. Each
 * card auto-saves on blur, exposes a `Test` button that calls the
 * matching probe endpoint, and lists recently used hosts as click-to-
 * fill chips.
 *
 * The component reads the server preferences once on mount and then
 * re-fetches after every PUT so the displayed values stay synced with
 * disk — including the MRU lists that the server maintains.
 */

interface Prefs {
  vmix_host: string;
  vmix_port: number;
  vmix_srt_port: number;
  polling_interval: number;
  ableton_host: string;
  ableton_send_port: number;
  ableton_recv_port: number;
  vmix_recent_hosts?: string[];
  ableton_recent_hosts?: string[];
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

export function ConnectionsPanel() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/preferences", { cache: "no-store" });
      if (!res.ok) return;
      setPrefs(await res.json());
    } catch {
      /* network blip — try again on next interaction */
    }
  }, []);

  useEffect(() => {
    // Initial server-state fetch. The setState happens inside refresh()
    // after the network round-trip — by then the effect mount frame is
    // done so this is not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  if (!prefs) {
    return (
      <div
        style={{
          padding: 16,
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        Loading connections…
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
        gap: 12,
        padding: 16,
      }}
    >
      <VmixCard prefs={prefs} onSaved={refresh} />
      <AbletonCard prefs={prefs} onSaved={refresh} />
    </div>
  );
}

// ────────────────────────── vMix card ──────────────────────────

function VmixCard({ prefs, onSaved }: { prefs: Prefs; onSaved: () => void }) {
  const connected = useVmixStore((s) => s.connected);
  const version = useVmixStore((s) => s.vmixState?.version ?? null);
  const edition = useVmixStore((s) => s.vmixState?.edition ?? null);
  const setConnectionInfo = useVmixStore((s) => s.setConnectionInfo);

  const [host, setHost] = useState(prefs.vmix_host);
  const [port, setPort] = useState(String(prefs.vmix_port));
  const [polling, setPolling] = useState(String(prefs.polling_interval));
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  // Mirror prefs into the local draft until the user starts typing.
  // We track the previous prefs value to detect external updates.
  const [lastSeen, setLastSeen] = useState({
    host: prefs.vmix_host,
    port: prefs.vmix_port,
    polling: prefs.polling_interval,
  });
  if (
    lastSeen.host !== prefs.vmix_host ||
    lastSeen.port !== prefs.vmix_port ||
    lastSeen.polling !== prefs.polling_interval
  ) {
    setLastSeen({
      host: prefs.vmix_host,
      port: prefs.vmix_port,
      polling: prefs.polling_interval,
    });
    setHost(prefs.vmix_host);
    setPort(String(prefs.vmix_port));
    setPolling(String(prefs.polling_interval));
  }

  const save = useCallback(
    async (overrides?: { host?: string; port?: number; polling?: number }) => {
      const newHost = (overrides?.host ?? host).trim();
      const newPort = overrides?.port ?? parseInt(port, 10);
      const newPolling = overrides?.polling ?? parseInt(polling, 10);
      if (!newHost || !Number.isFinite(newPort) || newPort <= 0) return;
      // Polling floor 50 ms / ceiling 5 000 ms — matches the broker's
      // FLOOR_MS guard. Invalid → revert to current saved value so the
      // user can keep typing without losing it.
      const clampedPolling =
        Number.isFinite(newPolling) && newPolling >= 50 && newPolling <= 5000
          ? newPolling
          : prefs.polling_interval;
      if (
        newHost === prefs.vmix_host &&
        newPort === prefs.vmix_port &&
        clampedPolling === prefs.polling_interval
      )
        return;
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vmix_host: newHost,
          vmix_port: newPort,
          polling_interval: clampedPolling,
        }),
      });
      if (res.ok) {
        setConnectionInfo(newHost, newPort, prefs.vmix_srt_port);
        onSaved();
        setTest({ kind: "idle" });
      }
    },
    [host, port, polling, prefs, setConnectionInfo, onSaved]
  );

  const runTest = useCallback(async () => {
    setTest({ kind: "running" });
    try {
      const res = await fetch("/api/vmix/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as
        | { ok: true; version: string; edition?: string }
        | { ok: false; error: string };
      if (data.ok) {
        setTest({
          kind: "ok",
          message: `vMix ${data.version}${data.edition ? ` · ${data.edition}` : ""}`,
        });
      } else {
        setTest({ kind: "err", message: data.error || "No reply" });
      }
    } catch (err) {
      setTest({
        kind: "err",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, []);

  /** Connect = save pending changes if any, then probe. Replaces the
   *  old `Test` button so the operator has a single explicit "go"
   *  action rather than having to remember the save-on-blur trick. */
  const handleConnect = useCallback(async () => {
    await save();
    await runTest();
  }, [save, runTest]);

  // Recent click = fill only. The operator clicks Save to commit.
  // Clearing the test state hint signals "this is now an untested
  // candidate" — same effect as editing a field by hand.
  const onRecentClick = (ip: string) => {
    setHost(ip);
    setTest({ kind: "idle" });
  };

  const handleRemoveRecent = useCallback(
    async (ip: string) => {
      const next = (prefs.vmix_recent_hosts ?? []).filter((h) => h !== ip);
      await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vmix_recent_hosts: next }),
      });
      onSaved();
    },
    [prefs.vmix_recent_hosts, onSaved]
  );

  const dirty =
    host.trim() !== prefs.vmix_host ||
    parseInt(port, 10) !== prefs.vmix_port ||
    parseInt(polling, 10) !== prefs.polling_interval;

  return (
    <Card
      title="vMix"
      statusPill={
        connected ? (
          <StatusPill role="green" variant="solid">
            Connected
          </StatusPill>
        ) : (
          <StatusPill role="muted">Offline</StatusPill>
        )
      }
      sub={
        connected && version
          ? `vMix ${version}${edition ? ` · ${edition}` : ""}`
          : "no vmix detected"
      }
    >
      <FieldRow>
        {/* No blur/Enter auto-save — the operator commits via the
            explicit Save button so the broker only swaps targets
            when they ask. Enter on any field triggers Save. */}
        <Field label="Host" flex={2}>
          <MonoInput
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
            placeholder="192.168.1.10"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Port · TCP" flex={1}>
          <MonoInput
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
          />
        </Field>
        <Field label="Poll · ms" flex={1}>
          <MonoInput
            type="number"
            value={polling}
            onChange={(e) => setPolling(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
            min={50}
            max={5000}
            title="State poll interval. 50–5000 ms. Lower = snappier UI, more vMix CPU."
          />
        </Field>
      </FieldRow>

      <ProtocolNote
        text="vMix Web API is HTTP/TCP. Default 8088. Allow inbound TCP on the vMix machine; outbound TCP from this host. Poll = how often the server re-reads vMix state (default 150 ms)."
      />

      <RecentRow
        hosts={prefs.vmix_recent_hosts ?? []}
        currentHost={prefs.vmix_host}
        onPick={onRecentClick}
        onRemove={handleRemoveRecent}
        rightSlot={
          <ConnectButton
            onConnect={handleConnect}
            state={test}
            disabled={!host.trim()}
            dirty={dirty}
          />
        }
      />

      <ConnectionStatus state={test} />
    </Card>
  );
}

// ───────────────────────── Ableton card ────────────────────────

function AbletonCard({
  prefs,
  onSaved,
}: {
  prefs: Prefs;
  onSaved: () => void;
}) {
  const status = useAbletonStore((s) => s.status);
  const version = useAbletonStore((s) => s.version);

  const [host, setHost] = useState(prefs.ableton_host);
  const [sendPort, setSendPort] = useState(String(prefs.ableton_send_port));
  const [recvPort, setRecvPort] = useState(String(prefs.ableton_recv_port));
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [helpOpen, setHelpOpen] = useState(false);

  const [lastSeen, setLastSeen] = useState({
    host: prefs.ableton_host,
    sendPort: prefs.ableton_send_port,
    recvPort: prefs.ableton_recv_port,
  });
  if (
    lastSeen.host !== prefs.ableton_host ||
    lastSeen.sendPort !== prefs.ableton_send_port ||
    lastSeen.recvPort !== prefs.ableton_recv_port
  ) {
    setLastSeen({
      host: prefs.ableton_host,
      sendPort: prefs.ableton_send_port,
      recvPort: prefs.ableton_recv_port,
    });
    setHost(prefs.ableton_host);
    setSendPort(String(prefs.ableton_send_port));
    setRecvPort(String(prefs.ableton_recv_port));
  }

  const save = useCallback(
    async (overrideHost?: string) => {
      const newHost = (overrideHost ?? host).trim();
      const newSend = parseInt(sendPort, 10);
      const newRecv = parseInt(recvPort, 10);
      if (!newHost || !Number.isFinite(newSend) || !Number.isFinite(newRecv)) {
        return;
      }
      if (
        newHost === prefs.ableton_host &&
        newSend === prefs.ableton_send_port &&
        newRecv === prefs.ableton_recv_port
      ) {
        return;
      }
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ableton_host: newHost,
          ableton_send_port: newSend,
          ableton_recv_port: newRecv,
        }),
      });
      if (res.ok) {
        onSaved();
        setTest({ kind: "idle" });
      }
    },
    [host, sendPort, recvPort, prefs, onSaved]
  );

  const runTest = useCallback(async () => {
    setTest({ kind: "running" });
    try {
      const res = await fetch("/api/ableton/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as
        | { ok: true; version: string }
        | { ok: false; error: string };
      if (data.ok) {
        setTest({ kind: "ok", message: `Live ${data.version}` });
      } else {
        setTest({ kind: "err", message: data.error || "No reply" });
      }
    } catch (err) {
      setTest({
        kind: "err",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, []);

  const handleConnect = useCallback(async () => {
    await save();
    await runTest();
  }, [save, runTest]);

  // Fill only — Save commits.
  const onRecentClick = (ip: string) => {
    setHost(ip);
    setTest({ kind: "idle" });
  };

  const handleRemoveRecent = useCallback(
    async (ip: string) => {
      const next = (prefs.ableton_recent_hosts ?? []).filter(
        (h) => h !== ip
      );
      await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ableton_recent_hosts: next }),
      });
      onSaved();
    },
    [prefs.ableton_recent_hosts, onSaved]
  );

  const dirty =
    host.trim() !== prefs.ableton_host ||
    parseInt(sendPort, 10) !== prefs.ableton_send_port ||
    parseInt(recvPort, 10) !== prefs.ableton_recv_port;

  return (
    <Card
      title="Ableton"
      statusPill={
        status === "connected" ? (
          <StatusPill role="green" variant="solid">
            Connected
          </StatusPill>
        ) : status === "connecting" ? (
          <StatusPill role="amber">Connecting</StatusPill>
        ) : (
          <StatusPill role="muted">Offline</StatusPill>
        )
      }
      sub={
        status === "connected" && version
          ? `Live ${version}`
          : status === "connecting"
            ? "Probing AbletonOSC…"
            : "no AbletonOSC reply"
      }
      right={
        <button
          onClick={() => setHelpOpen((v) => !v)}
          className="flex items-center justify-center transition-colors"
          style={{
            width: 28,
            height: 28,
            color: helpOpen ? "var(--amber)" : "var(--mid)",
            border: `1px solid ${helpOpen ? "var(--amber)" : "var(--line)"}`,
            background: helpOpen ? "var(--amber-tint)" : "var(--card)",
            transitionDuration: "80ms",
          }}
          title="AbletonOSC install guide"
          aria-label={helpOpen ? "Hide install guide" : "Show install guide"}
          aria-expanded={helpOpen}
        >
          <HelpCircle size={14} strokeWidth={1.5} />
        </button>
      }
    >
      <FieldRow>
        {/* Same explicit-save model as the vMix card — Enter on any
            field triggers Save; no blur auto-save. */}
        <Field label="Host" flex={2}>
          <MonoInput
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
            placeholder="127.0.0.1"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Send · UDP" flex={1}>
          <MonoInput
            type="number"
            value={sendPort}
            onChange={(e) => setSendPort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
          />
        </Field>
        <Field label="Recv · UDP" flex={1}>
          <MonoInput
            type="number"
            value={recvPort}
            onChange={(e) => setRecvPort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
          />
        </Field>
      </FieldRow>

      <ProtocolNote
        text="AbletonOSC uses OSC over UDP. Default Send 11000 / Recv 11001. Allow both UDP ports through the firewall on each side — UDP is connectionless, a one-way block silently drops replies."
      />

      <RecentRow
        hosts={prefs.ableton_recent_hosts ?? []}
        currentHost={prefs.ableton_host}
        onPick={onRecentClick}
        onRemove={handleRemoveRecent}
        rightSlot={
          <ConnectButton
            onConnect={handleConnect}
            state={test}
            disabled={!host.trim()}
            dirty={dirty}
          />
        }
      />

      <ConnectionStatus state={test} />

      {helpOpen && (
        <div
          style={{
            marginTop: 4,
            borderTop: "1px solid var(--line)",
            paddingTop: 12,
          }}
        >
          <InstallGuide />
        </div>
      )}
    </Card>
  );
}

// ────────────────────────── primitives ─────────────────────────

function Card({
  title,
  statusPill,
  sub,
  right,
  children,
}: {
  title: string;
  statusPill: React.ReactNode;
  sub: React.ReactNode;
  /** Optional top-right slot — used by Ableton card to host its help
   *  toggle. The header reserves space whether `right` is provided or
   *  not so the two cards line up vertically. */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ gap: 8 }}
      >
        <div className="flex items-center" style={{ gap: 10 }}>
          <span
            className="font-mono uppercase"
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "1.6px",
              color: "var(--ink)",
            }}
          >
            {title}
          </span>
          {statusPill}
        </div>
        {right}
      </div>
      <div
        className="font-mono"
        style={{ fontSize: 11, color: "var(--muted)" }}
      >
        {sub}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
      {children}
    </div>
  );
}

function Field({
  label,
  flex,
  children,
}: {
  label: string;
  flex: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ flex, minWidth: 0 }}>
      <div className="label" style={{ marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function ProtocolNote({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        lineHeight: 1.45,
        color: "var(--muted)",
        padding: "8px 10px",
        background: "var(--panel-2)",
        border: "1px dashed var(--line-hi)",
      }}
    >
      {text}
    </div>
  );
}

/**
 * Compact primary action — `[ Save ]`. Persists the draft fields and
 * probes the connection in one click. Nothing else commits the form
 * (no blur/Enter auto-save), so the operator stays in control of
 * when the broker actually swaps targets.
 */
function ConnectButton({
  onConnect,
  state,
  disabled,
  dirty,
}: {
  onConnect: () => void;
  state: TestState;
  disabled?: boolean;
  /** True when the draft differs from the saved prefs — drives the
   *  amber emphasis so the operator sees there's pending work. */
  dirty?: boolean;
}) {
  const isBusy = state.kind === "running";
  return (
    <button
      onClick={onConnect}
      disabled={isBusy || disabled}
      className="font-mono uppercase inline-flex items-center transition-colors"
      style={{
        gap: 6,
        padding: "6px 12px",
        fontSize: 10,
        letterSpacing: "1.4px",
        fontWeight: 700,
        background: dirty ? "var(--amber)" : "var(--amber-tint)",
        color: dirty ? "var(--bg)" : "var(--amber)",
        border: "1px solid var(--amber)",
        transitionDuration: "80ms",
        opacity: isBusy || disabled ? 0.5 : 1,
        cursor: isBusy || disabled ? "not-allowed" : "pointer",
      }}
      title={
        disabled
          ? "Enter a host first"
          : dirty
            ? "Save the new settings and probe the connection"
            : "Re-probe the saved connection"
      }
    >
      {isBusy ? "Saving…" : "Save"}
    </button>
  );
}

/** Status banner shown under the recent row. Two shapes (✓ / ✗) on
 *  the same primitive so the eye reads them as a single element. */
function ConnectionStatus({ state }: { state: TestState }) {
  if (state.kind === "ok") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="font-mono"
        style={{
          padding: "6px 10px",
          fontSize: 11,
          background: "var(--pvw-tint)",
          color: "var(--pvw)",
          border: "1px solid var(--pvw)",
        }}
      >
        ✓ Connected · {state.message}
      </div>
    );
  }
  if (state.kind === "err") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="font-mono"
        style={{
          padding: "6px 10px",
          fontSize: 11,
          background: "var(--pgm-tint)",
          color: "var(--pgm)",
          border: "1px solid var(--pgm)",
        }}
      >
        ✗ {state.message}
      </div>
    );
  }
  return null;
}

function RecentRow({
  hosts,
  currentHost,
  onPick,
  onRemove,
  rightSlot,
}: {
  hosts: string[];
  currentHost: string;
  onPick: (h: string) => void;
  onRemove: (h: string) => void;
  /** Optional element rendered at the end of the recent row — used
   *  by both cards to host their primary `Connect` button. */
  rightSlot?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
      }}
    >
      <span className="label">Recent</span>
      {hosts.length === 0 ? (
        <span
          className="font-mono"
          style={{ fontSize: 10, color: "var(--sub)" }}
        >
          —
        </span>
      ) : (
        hosts.map((h) => {
          const active = h === currentHost;
          return (
            <span
              key={h}
              className="font-mono uppercase inline-flex items-stretch"
              style={{
                fontSize: 10,
                letterSpacing: "1px",
                background: active ? "var(--pvw-tint)" : "var(--card)",
                color: active ? "var(--pvw)" : "var(--mid)",
                border: `1px solid ${active ? "var(--pvw)" : "var(--line-hi)"}`,
                transitionDuration: "80ms",
              }}
            >
              <button
                onClick={() => onPick(h)}
                disabled={active}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "inherit",
                  padding: "4px 8px",
                  font: "inherit",
                  letterSpacing: "inherit",
                  textTransform: "inherit",
                  cursor: active ? "default" : "pointer",
                }}
              >
                {h}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(h);
                }}
                title={`Remove ${h} from recent`}
                aria-label={`Remove ${h} from recent`}
                style={{
                  background: "transparent",
                  border: 0,
                  borderLeft: `1px solid ${active ? "var(--pvw)" : "var(--line-hi)"}`,
                  color: "var(--sub)",
                  padding: "4px 6px",
                  font: "inherit",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--pgm)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--sub)";
                }}
              >
                ✕
              </button>
            </span>
          );
        })
      )}
      {rightSlot && <span style={{ marginLeft: "auto" }}>{rightSlot}</span>}
    </div>
  );
}
