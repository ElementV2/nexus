"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { DeckLayout } from "@/lib/db/streamdeck";
import { collectConnRefs, isDefaultBucket } from "./export-utils";
import type {
  ConnectionLite,
  DeckExportFile,
  DeviceSummary,
  DevicesResponse,
} from "./types";

/**
 * Resolves connection references from an imported file. For each
 * referenced connection it offers: keep (if the same id exists
 * locally), map to a local connection of the same kind, or leave on
 * the kind default. Auto-selects the smartest default per row.
 */
export function ImportModal({
  payload,
  connections,
  onCancel,
  onConfirm,
}: {
  payload: DeckExportFile;
  connections: ConnectionLite[];
  onCancel: () => void;
  onConfirm: (mapping: Record<string, string>) => void;
}) {
  // Recompute refs from the imported layouts themselves (not just the
  // file's stored list) so EVERY referenced connection shows up —
  // pinned instances AND each kind's default bucket — even for older
  // export files. Pinned labels resolve from the file first, then
  // local connections.
  const refs = useMemo(() => {
    const lookup: ConnectionLite[] = [
      ...(payload.connections ?? []).map((c) => ({
        id: c.id,
        kind: c.kind,
        label: c.label,
        enabled: true,
      })),
      ...connections,
    ];
    return collectConnRefs(payload.layouts, lookup);
  }, [payload, connections]);
  const localById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections]
  );
  // Initial mapping: keep a connection that exists here verbatim;
  // otherwise (a bucket of unpinned actions, or a pin we don't have)
  // preselect the FIRST local connection of that kind so the imported
  // deck lands fully pinned to a real machine. No per-kind "default" —
  // decks are independent of it.
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const r of refs) {
      if (!isDefaultBucket(r.id) && localById.has(r.id)) {
        m[r.id] = r.id;
      } else {
        const sameKind = connections.filter((c) => c.kind === r.kind);
        m[r.id] = sameKind[0]?.id ?? "";
      }
    }
    return m;
  });

  return (
    <ModalShell
      title={`Import ${payload.layouts.length} page${payload.layouts.length !== 1 ? "s" : ""}`}
      onClose={onCancel}
    >
      <div style={{ fontSize: 12, color: "var(--mid)", marginBottom: 12 }}>
        {refs.length === 0
          ? "These pages don't reference any device — ready to import."
          : "Pick which connection on THIS machine runs each set of actions from the imported page."}
      </div>
      {refs.length > 0 && (
        <div className="space-y-2" style={{ marginBottom: 12 }}>
          {refs.map((r) => {
            const sameKind = connections.filter((c) => c.kind === r.kind);
            const bucket = isDefaultBucket(r.id);
            return (
              <div
                key={r.id}
                className="flex items-center gap-2"
                style={{
                  padding: 8,
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="font-mono"
                    style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)" }}
                  >
                    {bucket ? `${r.kind} actions` : r.label}
                  </div>
                  <div
                    className="font-mono"
                    style={{ fontSize: 9, color: "var(--sub)" }}
                  >
                    {bucket
                      ? "run these on →"
                      : `${r.kind}${localById.has(r.id) ? " · on this PC" : " · from another PC"}`}
                  </div>
                </div>
                <span style={{ color: "var(--sub)" }}>→</span>
                <select
                  value={mapping[r.id] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [r.id]: e.target.value }))
                  }
                  className="font-mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "4px 6px",
                    fontSize: 11,
                    background: "var(--panel-2)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                    outline: "none",
                  }}
                >
                  <option value="">Leave unpinned</option>
                  {sameKind.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                      {c.id === r.id ? " (same)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <ModalButton onClick={onCancel}>Cancel</ModalButton>
        <ModalButton primary onClick={() => onConfirm(mapping)}>
          Import
        </ModalButton>
      </div>
    </ModalShell>
  );
}

// ─────────────────────── Load-to-device modal ─────────────────────────

/**
 * Pick a physical Stream Deck + a page, then pair & push in one go.
 */
export function LoadToDeckModal({
  layouts,
  hw,
  selectedId,
  onClose,
  onLoad,
}: {
  layouts: DeckLayout[];
  hw: DevicesResponse | null;
  selectedId: string;
  onClose: () => void;
  onLoad: (layoutId: string, serial: string) => void | Promise<void>;
}) {
  const devices = hw?.devices ?? [];
  const [layoutId, setLayoutId] = useState(selectedId);
  const [serial, setSerial] = useState(
    devices.find((d) => d.serialNumber)?.serialNumber ?? ""
  );
  const depsMissing = hw?.status.state === "deps-missing";
  const noDevices = devices.length === 0;

  return (
    <ModalShell title="Load page to a Stream Deck" onClose={onClose}>
      {depsMissing ? (
        <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 12 }}>
          The HID driver isn&apos;t installed on this machine. Run{" "}
          <span className="font-mono">npm install</span>, or use a nexus-cross
          satellite on the PC the deck is plugged into.
        </div>
      ) : noDevices ? (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          No Stream Deck detected. Plug one in (or start a nexus-cross
          satellite) and reopen this dialog.
        </div>
      ) : (
        <>
          <ModalField label="Page">
            <select
              value={layoutId}
              onChange={(e) => setLayoutId(e.target.value)}
              className="font-mono"
              style={modalSelectStyle}
            >
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} · {Object.keys(l.bindings).length} keys
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Deck">
            <select
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              className="font-mono"
              style={modalSelectStyle}
            >
              {devices.map((d) => (
                <option
                  key={d.path}
                  value={d.serialNumber ?? ""}
                  disabled={!d.serialNumber}
                >
                  {/* Lead with the operator's friendly name if set, else the
                      satellite's announced name, so it's obvious which deck
                      this is — crucial with several identical decks whose
                      serials are opaque. */}
                  {d.name ? `${d.name} · ` : d.satelliteLabel ? `${d.satelliteLabel} · ` : ""}
                  {d.model}
                  {d.serialNumber ? ` · ${d.serialNumber}` : " · no serial"}
                </option>
              ))}
            </select>
          </ModalField>
        </>
      )}
      <div className="flex items-center justify-end gap-2" style={{ marginTop: 12 }}>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton
          primary
          disabled={!serial || noDevices || depsMissing}
          onClick={() => serial && void onLoad(layoutId, serial)}
        >
          Pair &amp; load
        </ModalButton>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────── Device manager ───────────────────────────

/**
 * Name every deck (USB / remote satellite / ScreenDeck) so the load picker
 * shows something readable instead of an opaque serial — essential with
 * several identical Stream Decks on one PC. Names persist in preferences,
 * keyed by serial (or ScreenDeck id), and survive reconnects. Also shows
 * which page is currently loaded on each deck.
 */
export function DeviceManagerModal({
  devices,
  layouts,
  onClose,
  onSaved,
}: {
  devices: DeviceSummary[];
  layouts: DeckLayout[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let off = false;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => r.json())
      .then((p: { deviceNames?: Record<string, string> }) => {
        if (!off) setNames(p.deviceNames ?? {});
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const connected = new Set(
    devices.map((d) => d.serialNumber).filter((s): s is string => !!s)
  );
  // Named-but-disconnected serials, so a stale name can still be cleared.
  const offline = Object.keys(names).filter((s) => !connected.has(s));

  const layoutFor = (serial: string) =>
    serial ? layouts.find((l) => l.deviceSerials.includes(serial)) : undefined;

  const kindOf = (path: string) =>
    path.startsWith("screendeck:")
      ? "ScreenDeck"
      : path.startsWith("satellite:")
        ? "Remote"
        : "USB";

  const setName = (serial: string, name: string) =>
    setNames((m) => {
      const next = { ...m };
      if (name.trim()) next[serial] = name;
      else delete next[serial];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceNames: names }),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Decks" onClose={onClose}>
      <div style={{ fontSize: 12, color: "var(--mid)", marginBottom: 12 }}>
        Give each deck a name so the load picker is readable — names stick by
        serial (ScreenDeck: by id) across reconnects.
      </div>
      {devices.length === 0 && offline.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          No deck connected — plug one in, or start ScreenDeck / a satellite.
        </div>
      ) : (
        <div className="space-y-2" style={{ marginBottom: 12 }}>
          {devices.map((d) => {
            const serial = d.serialNumber ?? "";
            const loaded = serial ? layoutFor(serial) : undefined;
            const geom =
              d.cols && d.rows ? ` · ${d.cols}×${d.rows}` : "";
            return (
              <DeviceRow
                key={d.path}
                kind={kindOf(d.path)}
                online
                serial={serial}
                placeholder={d.satelliteLabel || d.model}
                meta={`${d.model}${geom} · ${loaded ? loaded.label : "no page loaded"}`}
                value={serial ? names[serial] ?? "" : ""}
                disabled={!serial}
                onChange={(v) => serial && setName(serial, v)}
              />
            );
          })}
          {offline.map((serial) => {
            const loaded = layoutFor(serial);
            return (
              <DeviceRow
                key={serial}
                kind="offline"
                online={false}
                serial={serial}
                placeholder=""
                meta={loaded ? `last page: ${loaded.label}` : "disconnected"}
                value={names[serial] ?? ""}
                onChange={(v) => setName(serial, v)}
              />
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton primary disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </ModalButton>
      </div>
    </ModalShell>
  );
}

function DeviceRow({
  kind,
  online,
  serial,
  placeholder,
  meta,
  value,
  disabled,
  onChange,
}: {
  kind: string;
  online: boolean;
  serial: string;
  placeholder: string;
  meta: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        padding: 8,
        background: "var(--card)",
        border: "1px solid var(--line)",
        opacity: online ? 1 : 0.6,
      }}
    >
      <span
        className="font-mono uppercase"
        style={{
          fontSize: 8,
          letterSpacing: "0.08em",
          padding: "3px 5px",
          border: "1px solid var(--line-hi)",
          color: online ? "var(--mid)" : "var(--sub)",
          flexShrink: 0,
          width: 64,
          textAlign: "center",
        }}
      >
        {kind}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          type="text"
          value={value}
          placeholder={placeholder || "name this deck"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="font-mono"
          style={{
            width: "100%",
            padding: "4px 8px",
            fontSize: 11,
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        <div
          className="font-mono"
          style={{
            fontSize: 9,
            color: "var(--sub)",
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={`${serial || "no serial"} · ${meta}`}
        >
          {serial || "no serial"} · {meta}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Modal primitives ─────────────────────────

const modalSelectStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 12,
  background: "var(--panel-2)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
  outline: "none",
};

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "100%",
          maxHeight: "85vh",
          overflow: "auto",
          background: "var(--bg)",
          border: "1px solid var(--line-hi)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
      >
        <div
          className="flex items-center justify-between sw-hairline-bottom"
          style={{ padding: "12px 16px", background: "var(--panel)" }}
        >
          <span
            className="font-mono uppercase"
            style={{
              fontSize: 11,
              letterSpacing: "1.4px",
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              padding: 4,
              background: "transparent",
              border: 0,
              color: "var(--sub)",
              cursor: "pointer",
            }}
          >
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

function ModalField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        className="font-mono uppercase"
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          color: "var(--sub)",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function ModalButton({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="font-mono uppercase"
      style={{
        padding: "6px 14px",
        fontSize: 10,
        letterSpacing: "1.4px",
        fontWeight: 700,
        background: primary
          ? disabled
            ? "var(--panel-2)"
            : "var(--amber)"
          : "transparent",
        color: primary
          ? disabled
            ? "var(--sub)"
            : "var(--bg)"
          : "var(--mid)",
        border: primary ? "1px solid var(--amber)" : "1px solid var(--line-hi)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}
