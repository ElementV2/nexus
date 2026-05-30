"use client";

import { useCallback, useRef, useState } from "react";
import { useObsStore } from "@/stores/obs-store";
import { useObsCommand } from "@/hooks/use-obs-command";
import { Section, Eyebrow } from "@/components/sw";

/* ── Filters drawer (lazy fetch on expand) ────────────────────── */

interface FilterInfo {
  filterName: string;
  filterKind: string;
  filterEnabled: boolean;
  filterIndex: number;
}

export function FiltersDrawer({ sceneName }: { sceneName: string | null }) {
  const [open, setOpen] = useState(false);
  const items = useObsStore(
    (s) =>
      sceneName ? s.snapshot?.sceneItemsByScene[sceneName] ?? null : null
  );
  const send = useObsCommand();

  // sourceName → filters; lazily fetched on first expand. The whole
  // component is keyed on sceneName by the parent so this state is
  // dropped on scene switch — no manual reset needed.
  const [filtersBySource, setFiltersBySource] = useState<
    Record<string, FilterInfo[]>
  >({});
  const [loading, setLoading] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const fetchFilters = useCallback(
    async (sourceName: string) => {
      if (seen.current.has(sourceName)) return;
      seen.current.add(sourceName);
      setLoading(sourceName);
      const r = await send({
        action: "raw",
        requestType: "GetSourceFilterList",
        requestData: { sourceName },
      });
      setLoading(null);
      if (
        r.ok &&
        r.data &&
        typeof r.data === "object" &&
        "filters" in r.data
      ) {
        const list = (r.data as { filters: FilterInfo[] }).filters;
        setFiltersBySource((prev) => ({ ...prev, [sourceName]: list }));
      }
    },
    [send]
  );

  if (!sceneName) return null;

  return (
    <Section>
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono uppercase"
        style={{
          padding: "6px 10px",
          fontSize: 10,
          letterSpacing: "1.4px",
          fontWeight: 700,
          background: open ? "var(--amber-tint)" : "var(--card)",
          color: open ? "var(--amber)" : "var(--mid)",
          border: `1px solid ${open ? "var(--amber)" : "var(--line-hi)"}`,
          cursor: "pointer",
        }}
      >
        {open ? "▼" : "▶"} Filters · {sceneName}
      </button>

      {open && items && (
        <div style={{ marginTop: 12 }}>
          {items.map((it) => {
            const filters = filtersBySource[it.sourceName];
            return (
              <div
                key={it.sceneItemId}
                style={{
                  borderTop: "1px dashed var(--line)",
                  padding: "8px 0",
                }}
              >
                <div
                  className="flex items-center"
                  style={{ gap: 8, marginBottom: 4 }}
                >
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    {it.sourceName}
                  </span>
                  <button
                    onClick={() => fetchFilters(it.sourceName)}
                    className="font-mono uppercase"
                    style={{
                      padding: "2px 8px",
                      fontSize: 9,
                      letterSpacing: "1.4px",
                      background: "var(--card)",
                      color: "var(--mid)",
                      border: "1px solid var(--line-hi)",
                      cursor: "pointer",
                    }}
                  >
                    {filters ? "Refresh" : "Load"}
                  </button>
                  {loading === it.sourceName && (
                    <span
                      className="font-mono"
                      style={{ fontSize: 10, color: "var(--sub)" }}
                    >
                      …
                    </span>
                  )}
                </div>
                {filters && filters.length === 0 && (
                  <div
                    className="font-mono"
                    style={{ fontSize: 10, color: "var(--sub)" }}
                  >
                    No filters.
                  </div>
                )}
                {filters &&
                  filters.map((f) => (
                    <div
                      key={f.filterName}
                      className="flex items-center"
                      style={{ gap: 8, padding: "2px 0" }}
                    >
                      <button
                        onClick={() => {
                          send({
                            action: "raw",
                            requestType: "SetSourceFilterEnabled",
                            requestData: {
                              sourceName: it.sourceName,
                              filterName: f.filterName,
                              filterEnabled: !f.filterEnabled,
                            },
                          });
                          // Optimistic toggle — OBS doesn't fire an
                          // event for this so we have to update locally.
                          setFiltersBySource((prev) => ({
                            ...prev,
                            [it.sourceName]: prev[it.sourceName].map((x) =>
                              x.filterName === f.filterName
                                ? { ...x, filterEnabled: !x.filterEnabled }
                                : x
                            ),
                          }));
                        }}
                        className="font-mono uppercase"
                        style={{
                          padding: "2px 8px",
                          fontSize: 9,
                          letterSpacing: "1.4px",
                          background: f.filterEnabled
                            ? "var(--pvw-tint)"
                            : "var(--card)",
                          color: f.filterEnabled
                            ? "var(--pvw)"
                            : "var(--mid)",
                          border: `1px solid ${
                            f.filterEnabled
                              ? "var(--pvw)"
                              : "var(--line-hi)"
                          }`,
                          cursor: "pointer",
                        }}
                      >
                        {f.filterEnabled ? "ON" : "OFF"}
                      </button>
                      <span
                        className="font-mono"
                        style={{ fontSize: 11, color: "var(--ink)" }}
                      >
                        {f.filterName}
                      </span>
                      <span
                        className="font-mono"
                        style={{ fontSize: 10, color: "var(--sub)" }}
                      >
                        {f.filterKind}
                      </span>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ── Profiles + scene collections ────────────────────────────── */

export function ProfilesAndCollections() {
  const profiles = useObsStore((s) => s.snapshot?.profiles ?? []);
  const currentProfile = useObsStore(
    (s) => s.snapshot?.currentProfile ?? null
  );
  const collections = useObsStore(
    (s) => s.snapshot?.sceneCollections ?? []
  );
  const currentCollection = useObsStore(
    (s) => s.snapshot?.currentSceneCollection ?? null
  );
  const send = useObsCommand();

  if (profiles.length === 0 && collections.length === 0) return null;

  return (
    <Section>
      <Eyebrow tone="amber" className="mb-3">
        Profile · Scene Collection
      </Eyebrow>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", minWidth: 200 }}>
          <Eyebrow tone="muted">Profile</Eyebrow>
          <select
            value={currentProfile ?? ""}
            onChange={(e) =>
              send({ action: "set-profile", name: e.target.value })
            }
            className="font-mono"
            style={{
              width: "100%",
              marginTop: 4,
              padding: "4px 6px",
              fontSize: 11,
              background: "var(--card)",
              color: "var(--ink)",
              border: "1px solid var(--line-hi)",
            }}
          >
            {profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 200 }}>
          <Eyebrow tone="muted">Scene Collection</Eyebrow>
          <select
            value={currentCollection ?? ""}
            onChange={(e) =>
              send({
                action: "set-scene-collection",
                name: e.target.value,
              })
            }
            className="font-mono"
            style={{
              width: "100%",
              marginTop: 4,
              padding: "4px 6px",
              fontSize: 11,
              background: "var(--card)",
              color: "var(--ink)",
              border: "1px solid var(--line-hi)",
            }}
          >
            {collections.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Section>
  );
}

/* ── Hotkey runner ───────────────────────────────────────────── */

export function HotkeyRunner() {
  const [name, setName] = useState("");
  const send = useObsCommand();
  return (
    <Section>
      <Eyebrow tone="amber" className="mb-3">
        Hotkey
      </Eyebrow>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="OBSBasic.Transition"
          className="font-mono"
          style={{
            flex: 1,
            padding: "4px 6px",
            fontSize: 11,
            background: "var(--card)",
            color: "var(--ink)",
            border: "1px solid var(--line-hi)",
          }}
        />
        <button
          onClick={() => name.trim() && send({ action: "trigger-hotkey", name })}
          className="font-mono uppercase"
          style={{
            padding: "4px 10px",
            fontSize: 10,
            letterSpacing: "1.4px",
            fontWeight: 700,
            background: "var(--amber)",
            color: "var(--bg)",
            border: "1px solid var(--amber)",
            cursor: "pointer",
          }}
        >
          Trigger →
        </button>
      </div>
      <div
        className="font-mono"
        style={{ marginTop: 4, fontSize: 10, color: "var(--sub)" }}
      >
        Hotkey names come from your OBS profile config. Find them in
        OBS › Settings › Hotkeys.
      </div>
    </Section>
  );
}
