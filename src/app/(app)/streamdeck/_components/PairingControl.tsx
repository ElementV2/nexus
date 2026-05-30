"use client";

import { Eyebrow, MonoChip } from "@/components/sw";
import { Usb, RefreshCw } from "lucide-react";
import type { DeckLayout } from "@/lib/db/streamdeck";
import type { DevicesResponse } from "./types";

/**
 * Toolbar widget for the layout↔device pairing. Three states:
 *
 *   • Driver missing → tooltip chip + nothing else (deps install).
 *   • No physical decks detected → grey "no deck" with a refresh icon.
 *   • Devices present → dropdown that lists every detected deck plus
 *     "Unpaired (design-only)". Each device row shows whether it's
 *     already claimed by another layout (the operator can re-assign,
 *     which moves the device's bindings to the current layout).
 *
 * Push button targets the currently paired device. When unpaired
 * the button is disabled with a tooltip hinting the operator to
 * pair first.
 */
export function PairingControl({
  hw,
  layouts,
  currentLayoutId,
  currentPairedSerial,
  onPair,
  onRefresh,
  onPushAll,
}: {
  hw: DevicesResponse | null;
  layouts: DeckLayout[];
  currentLayoutId: string;
  currentPairedSerial: string | null;
  onPair: (serial: string | null) => void;
  onRefresh: () => void;
  onPushAll: () => void;
}) {
  if (!hw) {
    return <MonoChip>HW · loading</MonoChip>;
  }
  if (hw.status.state === "deps-missing") {
    return (
      <span
        title={
          hw.status.reason ??
          "Run `npm install` in the project root to install the HID driver"
        }
      >
        <MonoChip>
          <Usb size={10} style={{ marginRight: 4, display: "inline" }} />
          driver missing
        </MonoChip>
      </span>
    );
  }
  const driverReady = hw.status.state === "ready";
  const hasDevices = hw.devices.length > 0;
  const pairedDevice = currentPairedSerial
    ? hw.devices.find((d) => d.serialNumber === currentPairedSerial)
    : undefined;
  const canPush = driverReady && !!pairedDevice;

  return (
    <div className="flex items-center gap-2">
      <Eyebrow tone="muted">Paired</Eyebrow>
      <select
        value={currentPairedSerial ?? ""}
        onChange={(e) => onPair(e.target.value || null)}
        className="font-mono"
        style={{
          padding: "4px 8px",
          fontSize: 11,
          background: "var(--card)",
          border: "1px solid var(--line-hi)",
          color: pairedDevice
            ? "var(--ink)"
            : currentPairedSerial
              ? "var(--amber)"
              : "var(--sub)",
          outline: "none",
          cursor: "pointer",
          maxWidth: 240,
        }}
        title={
          pairedDevice
            ? `Currently paired with ${pairedDevice.model} · ${pairedDevice.serialNumber}`
            : currentPairedSerial
              ? `Paired serial ${currentPairedSerial} is not connected`
              : "Pair this layout with a connected device"
        }
      >
        <option value="">— Unpaired (design only)</option>
        {hasDevices ? (
          hw.devices.map((d) => {
            const claimedBy = layouts.find(
              (l) =>
                l.deviceSerial === d.serialNumber && l.id !== currentLayoutId
            );
            const labelBits = [d.model];
            if (d.serialNumber) labelBits.push(d.serialNumber);
            if (claimedBy) labelBits.push(`(used by ${claimedBy.label})`);
            return (
              <option
                key={d.path}
                value={d.serialNumber ?? ""}
                disabled={!d.serialNumber}
              >
                {labelBits.join(" · ")}
              </option>
            );
          })
        ) : (
          <option value="" disabled>
            No device detected
          </option>
        )}
        {/* Phantom entry when the paired serial is unplugged — keeps
            the selection visible so the user can re-plug or unpair. */}
        {currentPairedSerial &&
          !pairedDevice &&
          hw.devices.every((d) => d.serialNumber !== currentPairedSerial) && (
            <option value={currentPairedSerial}>
              {currentPairedSerial} (not connected)
            </option>
          )}
      </select>
      <button
        onClick={onRefresh}
        title="Re-scan for connected decks"
        className="flex items-center justify-center"
        style={{
          padding: 6,
          background: "var(--panel-2)",
          border: "1px solid var(--line-hi)",
          color: "var(--mid)",
          cursor: "pointer",
        }}
      >
        <RefreshCw size={11} />
      </button>
      <button
        onClick={onPushAll}
        disabled={!canPush}
        title={
          !driverReady
            ? "Driver not ready"
            : !pairedDevice
              ? "Pair this layout with a device first"
              : `Render every binding to ${pairedDevice.model}`
        }
        className="flex items-center gap-1 font-mono uppercase"
        style={{
          padding: "4px 10px",
          fontSize: 10,
          letterSpacing: "1.4px",
          background: canPush ? "var(--ink)" : "var(--panel-2)",
          color: canPush ? "var(--bg)" : "var(--sub)",
          border: canPush ? "1px solid var(--ink)" : "1px solid var(--line)",
          cursor: canPush ? "pointer" : "not-allowed",
          opacity: canPush ? 1 : 0.55,
          fontWeight: 600,
        }}
      >
        <Usb size={11} /> Push all
      </button>
    </div>
  );
}
