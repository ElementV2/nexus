"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { DeckLayout } from "@/lib/db/streamdeck";
import { collectConnRefs, isDefaultBucket } from "./export-utils";
import type {
  ConnectionLite,
  DeckExportFile,
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
                  {/* Lead with the satellite's NAME (on network) so it's
                      obvious which machine the deck is on — that already
                      says where it is, so no misleading "(remote)" tag. */}
                  {d.satelliteLabel ? `${d.satelliteLabel} · ` : ""}
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
