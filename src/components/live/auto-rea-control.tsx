"use client";

import { useState } from "react";
import type { VmixInput } from "@/lib/vmix/types";
import { useAutoSwitch } from "@/hooks/use-auto-switch";
import { AutoSwitchModal } from "./auto-switch-modal";

/**
 * Self-contained auto-réalisation control for the Live header. It owns the
 * `useAutoSwitch` subscription so the engine's SSE stream re-renders ONLY this
 * small subtree — never the parent Live page or its (up to 200) input tiles.
 * Renders the ON/OFF toggle + gear, and the settings modal.
 */
export function AutoReaControl({ inputs }: { inputs: VmixInput[] }) {
  const { config, state, saveConfig, toggle } = useAutoSwitch();
  const [open, setOpen] = useState(false);

  // Prefer the LIVE engine state for the on/off display: the engine can turn
  // itself off (manual-hold mode), which the SSE state reflects immediately
  // while `config` only refreshes on the next POST.
  const enabled = state ? state.enabled : !!config?.enabled;
  const running = !!state?.running;
  const reason = state?.reason;

  return (
    <div
      className="flex flex-col justify-center"
      style={{
        padding: "8px 12px",
        background: "var(--panel-2)",
        borderRight: "1px solid var(--line)",
        borderLeft: "1px solid var(--line)",
        minWidth: 150,
        gap: 4,
      }}
    >
      <span className="label" style={{ marginBottom: 1 }}>
        AUTO-RÉA
      </span>
      <div className="flex items-center" style={{ gap: 6 }}>
        <button
          onClick={toggle}
          disabled={!config}
          aria-pressed={enabled}
          className="font-mono uppercase flex items-center justify-center"
          style={{
            flex: 1,
            gap: 6,
            padding: "6px 10px",
            fontSize: 11,
            letterSpacing: "0.14em",
            fontWeight: 700,
            cursor: config ? "pointer" : "default",
            background: enabled ? "var(--amber)" : "var(--card)",
            color: enabled ? "var(--bg)" : "var(--mid)",
            border: "1px solid var(--line-hi)",
            transition: "background 80ms ease, color 80ms ease",
          }}
        >
          <span
            aria-hidden
            className={running ? "auto-rea-dot--live" : undefined}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: enabled ? "var(--bg)" : "var(--line-hi)",
              opacity: running ? 1 : 0.5,
            }}
          />
          {enabled ? "ON" : "OFF"}
        </button>
        <button
          onClick={() => setOpen(true)}
          aria-label="Réglages auto-réalisation"
          title="Réglages"
          className="flex items-center justify-center"
          style={{
            width: 30,
            height: 30,
            fontSize: 14,
            cursor: "pointer",
            background: "var(--card)",
            color: "var(--mid)",
            border: "1px solid var(--line-hi)",
          }}
        >
          ⚙
        </button>
      </div>
      <span
        className="font-mono truncate"
        style={{ fontSize: 9, color: enabled ? "var(--amber)" : "var(--muted)", letterSpacing: "0.04em" }}
        title={reason}
      >
        {enabled ? reason || "—" : "désactivée"}
      </span>

      {open && config && (
        <AutoSwitchModal
          config={config}
          inputs={inputs}
          state={state}
          onChange={saveConfig}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
