"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { TopBar } from "@/components/sw/TopBar";
import { useLogStore, type ClientLogEntry, type ClientLogLevel } from "@/stores/log-store";

/* ── time + formatting helpers ─────────────────────────────────────── */
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function clock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
function stamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(ts)}`;
}
const LEVELS: ClientLogLevel[] = ["debug", "info", "warn", "error"];
const LEVEL_COLOR: Record<ClientLogLevel, string> = {
  debug: "var(--muted)",
  info: "var(--mid)",
  warn: "var(--amber)",
  error: "var(--pgm)",
};
const LEVEL_LABEL: Record<ClientLogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

/* ── CSV export (BOM so Excel reads UTF-8 accents correctly) ───────── */
function csvField(s: string): string {
  const flat = s.replace(/\r?\n/g, " ");
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}
function toCsv(entries: ClientLogEntry[]): string {
  const rows = entries.map(
    (e) => `${stamp(e.ts)},${LEVEL_LABEL[e.level]},${csvField(e.scope)},${csvField(e.message)}`
  );
  return "﻿Time,Level,Scope,Message\n" + rows.join("\n") + "\n";
}
function toText(entries: ClientLogEntry[]): string {
  return entries
    .map((e) => `${stamp(e.ts)}  ${LEVEL_LABEL[e.level].padEnd(5)}  [${e.scope}]  ${e.message}`)
    .join("\n");
}

/* ── small control primitives matching the app's mono chrome ───────── */
function Btn({
  onClick,
  children,
  active,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="font-mono uppercase"
      style={{
        fontSize: 9,
        letterSpacing: "0.12em",
        fontWeight: 600,
        padding: "5px 9px",
        background: active ? "var(--panel-2)" : "var(--card)",
        color: disabled ? "var(--sub)" : active ? "var(--ink)" : "var(--mid)",
        border: "1px solid var(--line-hi)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function LogsPage() {
  const entries = useLogStore((s) => s.entries);
  const clear = useLogStore((s) => s.clear);

  const [enabled, setEnabled] = useState<Record<ClientLogLevel, boolean>>({
    debug: true,
    info: true,
    warn: true,
    error: true,
  });
  const [scope, setScope] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const [copied, setCopied] = useState(false);

  // Scopes present in the buffer, for the dropdown.
  const scopes = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.scope);
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!enabled[e.level]) return false;
      if (scope !== "all" && e.scope !== scope) return false;
      if (q && !e.message.toLowerCase().includes(q) && !e.scope.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [entries, enabled, scope, query]);

  // Counts per level (on the full buffer) — drives the toggle badges.
  const counts = useMemo(() => {
    const c: Record<ClientLogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const e of entries) c[e.level]++;
    return c;
  }, [entries]);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoscroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [filtered, autoscroll]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(toText(filtered));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the Download button is the fallback */
    }
  }

  function download() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexus-client-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        num="09"
        label="Logs"
        title="Client logs"
        sub={`${filtered.length} / ${entries.length} this session`}
      />

      {/* Toolbar: level toggles · scope · search · actions */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-2"
        style={{ background: "var(--panel)", borderBottom: "1px solid var(--line)" }}
      >
        {LEVELS.map((lv) => (
          <Btn key={lv} onClick={() => setEnabled((e) => ({ ...e, [lv]: !e[lv] }))} active={enabled[lv]}>
            <span style={{ color: enabled[lv] ? LEVEL_COLOR[lv] : "inherit" }}>
              {LEVEL_LABEL[lv]} {counts[lv]}
            </span>
          </Btn>
        ))}

        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="font-mono"
          style={{
            fontSize: 10,
            padding: "4px 8px",
            background: "var(--card)",
            color: "var(--ink)",
            border: "1px solid var(--line-hi)",
          }}
        >
          {scopes.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "all scopes" : s}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="font-mono"
          style={{
            fontSize: 11,
            padding: "4px 8px",
            minWidth: 140,
            background: "var(--card)",
            color: "var(--ink)",
            border: "1px solid var(--line-hi)",
          }}
        />

        <div className="flex-1" />

        <Btn onClick={() => setAutoscroll((v) => !v)} active={autoscroll}>
          Auto-scroll
        </Btn>
        <Btn onClick={copy} disabled={filtered.length === 0}>
          {copied ? "Copied ✓" : "Copy"}
        </Btn>
        <Btn onClick={download} disabled={filtered.length === 0}>
          Download .csv
        </Btn>
        <Btn onClick={clear} disabled={entries.length === 0}>
          Clear
        </Btn>
      </div>

      {/* Log body */}
      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto font-mono"
        style={{ background: "var(--bg)", fontSize: 11, lineHeight: 1.55, padding: "8px 12px" }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: "var(--sub)", padding: "24px 4px" }}>
            {entries.length === 0
              ? "No client logs yet this session. They appear here live as you use the app, and clear on refresh (F5). The persistent server log is a CSV file on the host machine."
              : "No entries match the current filters."}
          </div>
        ) : (
          filtered.map((e) => (
            <div key={e.id} className="flex" style={{ gap: 12, padding: "1px 0", wordBreak: "break-word" }}>
              <span style={{ color: "var(--sub)", flexShrink: 0 }}>{clock(e.ts)}</span>
              <span
                style={{ color: LEVEL_COLOR[e.level], flexShrink: 0, width: 42, fontWeight: 600 }}
              >
                {LEVEL_LABEL[e.level]}
              </span>
              <span style={{ color: "var(--muted)", flexShrink: 0, minWidth: 96 }}>[{e.scope}]</span>
              <span style={{ color: "var(--ink)", whiteSpace: "pre-wrap" }}>{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
