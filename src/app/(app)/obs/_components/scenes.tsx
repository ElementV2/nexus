"use client";

import { useState } from "react";
import {
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { useObsStore } from "@/stores/obs-store";
import { useObsCommand } from "@/hooks/use-obs-command";
import {
  Section,
  Eyebrow,
  HairlineRow,
  StatusPill,
  MonoChip,
  useConfirm,
} from "@/components/sw";
import { ObsThumbnail } from "./obs-thumbnail";

/* ── Scene CRUD (create + remove + rename) ───────────────────── */

export function SceneCrudBar({
  selected,
  onCreated,
}: {
  selected: string | null;
  onCreated: (name: string) => void;
}) {
  const send = useObsCommand();
  const confirm = useConfirm();
  const [newName, setNewName] = useState("");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "6px 12px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
        alignItems: "center",
      }}
    >
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="new scene name"
        className="font-mono"
        style={{
          padding: "4px 6px",
          fontSize: 11,
          background: "var(--card)",
          color: "var(--ink)",
          border: "1px solid var(--line-hi)",
          width: 160,
        }}
      />
      <button
        onClick={async () => {
          const n = newName.trim();
          if (!n) return;
          const r = await send({ action: "create-scene", sceneName: n });
          if (r.ok) {
            setNewName("");
            onCreated(n);
          }
        }}
        className="font-mono uppercase"
        style={{
          padding: "4px 10px",
          fontSize: 10,
          letterSpacing: "1.4px",
          fontWeight: 700,
          background: "var(--amber-tint)",
          color: "var(--amber)",
          border: "1px solid var(--amber)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Plus size={12} /> Scene
      </button>
      {selected && (
        <button
          onClick={async () => {
            const ok = await confirm({
              title: `Remove scene "${selected}"?`,
              message:
                "Deletes the scene from OBS. Sources used elsewhere are kept.",
              dangerous: true,
              confirmLabel: "Remove",
            });
            if (!ok) return;
            send({ action: "remove-scene", sceneName: selected });
          }}
          className="font-mono uppercase"
          style={{
            padding: "4px 10px",
            fontSize: 10,
            letterSpacing: "1.4px",
            fontWeight: 700,
            background: "var(--card)",
            color: "var(--pgm)",
            border: "1px solid var(--pgm)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
          title={`Remove ${selected}`}
        >
          <Trash2 size={12} /> {selected}
        </button>
      )}
    </div>
  );
}

/* ── Scene grid ──────────────────────────────────────────────── */

export function SceneGrid({
  scenes,
  pgm,
  pvw,
  studio,
  selected,
  onSelect,
}: {
  scenes: { name: string; uuid: string; index: number }[];
  pgm: string | null;
  pvw: string | null;
  studio: boolean;
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  const send = useObsCommand();

  return (
    <main style={{ padding: 12 }}>
      <div
        className="flex flex-wrap content-start"
        style={{ gap: 6 }}
      >
        {scenes.map((s) => {
          const isPgm = s.name === pgm;
          const isPvw = s.name === pvw;
          const isSel = selected === s.name;
          const tint = isPgm
            ? "var(--pgm-tint)"
            : isPvw
              ? "var(--pvw-tint)"
              : isSel
                ? "var(--panel-2)"
                : "var(--card)";
          const border = isPgm
            ? "var(--pgm)"
            : isPvw
              ? "var(--pvw)"
              : isSel
                ? "var(--amber)"
                : "var(--line)";
          return (
            <div
              key={s.uuid}
              style={{
                flex: "1 1 180px",
                minWidth: 180,
                maxWidth: 280,
              }}
            >
              <button
                onClick={() => {
                  onSelect(s.name);
                  // Single-click: in studio mode → preview, else → program
                  if (studio) {
                    send({ action: "set-preview-scene", sceneName: s.name });
                  } else {
                    send({ action: "set-program-scene", sceneName: s.name });
                  }
                }}
                onDoubleClick={() => {
                  // Always force program in studio mode via double-click.
                  send({ action: "set-program-scene", sceneName: s.name });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(s.name);
                }}
                className="w-full text-left"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: 6,
                  background: tint,
                  border: `1.5px solid ${border}`,
                  cursor: "pointer",
                }}
                title={
                  studio
                    ? "Click = preview · double-click = program"
                    : "Click = program"
                }
              >
                <ObsThumbnail sourceName={s.name} width={320} height={180} />
                <div
                  className="flex items-center"
                  style={{ gap: 4, padding: "0 2px" }}
                >
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      color: "var(--ink)",
                      fontWeight: 600,
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                  </span>
                  {isPgm && (
                    <StatusPill role="red" variant="solid">
                      PGM
                    </StatusPill>
                  )}
                  {isPvw && (
                    <StatusPill role="green" variant="solid">
                      PVW
                    </StatusPill>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
      {scenes.length === 0 && (
        <div className="py-16 text-center text-[12px] text-sw-muted">
          No scenes.
        </div>
      )}
    </main>
  );
}

/* ── Scene inspector: items list + transform ─────────────────── */

export function SceneInspector({
  sceneName,
  isPgm,
  isPvw,
}: {
  sceneName: string;
  isPgm: boolean;
  isPvw: boolean;
}) {
  const items = useObsStore(
    (s) => s.snapshot?.sceneItemsByScene[sceneName] ?? null
  );
  return (
    <Section>
      <div className="flex items-baseline" style={{ gap: 8, marginBottom: 8 }}>
        <Eyebrow tone="amber">Scene items</Eyebrow>
        <MonoChip>{sceneName}</MonoChip>
        {isPgm && (
          <StatusPill role="red" variant="solid">
            PGM
          </StatusPill>
        )}
        {isPvw && (
          <StatusPill role="green" variant="solid">
            PVW
          </StatusPill>
        )}
      </div>
      {items === null ? (
        <div className="text-[12px] text-sw-muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-[12px] text-sw-muted">Empty scene.</div>
      ) : (
        <>
          {items.map((it) => (
            <SceneItemRow
              key={it.sceneItemId}
              sceneName={sceneName}
              item={it}
            />
          ))}
        </>
      )}
    </Section>
  );
}

function SceneItemRow({
  sceneName,
  item,
}: {
  sceneName: string;
  item: {
    sceneItemId: number;
    sourceName: string;
    sceneItemEnabled: boolean;
    sceneItemLocked: boolean;
    inputKind: string | null;
    isGroup: boolean;
    transform?: {
      positionX: number;
      positionY: number;
      width: number;
      height: number;
      rotation: number;
    };
  };
}) {
  const it = item;
  const send = useObsCommand();
  const confirm = useConfirm();
  const active = useObsStore((s) => s.inputActive[it.sourceName]);
  const isBrowser =
    !!it.inputKind && it.inputKind.toLowerCase().includes("browser");
  return (
    <HairlineRow className="flex items-center">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-baseline" style={{ gap: 8 }}>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 12,
                      color: "var(--ink)",
                      fontWeight: 600,
                    }}
                  >
                    {it.sourceName}
                  </span>
                  {it.inputKind && (
                    <MonoChip>{it.inputKind.replace(/_/g, " ")}</MonoChip>
                  )}
                  {it.isGroup && <MonoChip>group</MonoChip>}
                  {active?.videoActive && (
                    <StatusPill role="red" variant="solid">
                      LIVE
                    </StatusPill>
                  )}
                  {active && !active.videoActive && active.videoShowing && (
                    <StatusPill role="green">PVW</StatusPill>
                  )}
                </div>
                {it.transform && (
                  <div
                    className="font-mono"
                    style={{
                      fontSize: 10,
                      color: "var(--sub)",
                      marginTop: 2,
                    }}
                  >
                    {Math.round(it.transform.positionX)}×{Math.round(it.transform.positionY)}
                    {" · "}
                    {Math.round(it.transform.width)}×{Math.round(it.transform.height)}
                    {it.transform.rotation !== 0 &&
                      ` · ${Math.round(it.transform.rotation)}°`}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() =>
                    send({
                      action: "set-scene-item-enabled",
                      sceneName,
                      sceneItemId: it.sceneItemId,
                      enabled: !it.sceneItemEnabled,
                    })
                  }
                  className="font-mono"
                  style={{
                    width: 28,
                    height: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: it.sceneItemEnabled
                      ? "var(--pvw-tint)"
                      : "var(--card)",
                    color: it.sceneItemEnabled ? "var(--pvw)" : "var(--mid)",
                    border: `1px solid ${
                      it.sceneItemEnabled ? "var(--pvw)" : "var(--line-hi)"
                    }`,
                    cursor: "pointer",
                  }}
                  title={it.sceneItemEnabled ? "Hide" : "Show"}
                  aria-label={it.sceneItemEnabled ? "Hide" : "Show"}
                >
                  {it.sceneItemEnabled ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button
                  onClick={() =>
                    send({
                      action: "set-scene-item-locked",
                      sceneName,
                      sceneItemId: it.sceneItemId,
                      locked: !it.sceneItemLocked,
                    })
                  }
                  className="font-mono"
                  style={{
                    width: 28,
                    height: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: it.sceneItemLocked
                      ? "var(--amber-tint)"
                      : "var(--card)",
                    color: it.sceneItemLocked ? "var(--amber)" : "var(--mid)",
                    border: `1px solid ${
                      it.sceneItemLocked ? "var(--amber)" : "var(--line-hi)"
                    }`,
                    cursor: "pointer",
                  }}
                  title={it.sceneItemLocked ? "Unlock" : "Lock"}
                  aria-label={it.sceneItemLocked ? "Unlock" : "Lock"}
                >
                  {it.sceneItemLocked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
                {isBrowser && (
                  <button
                    onClick={() =>
                      send({
                        action: "refresh-browser-source",
                        inputName: it.sourceName,
                      })
                    }
                    className="font-mono"
                    style={{
                      width: 28,
                      height: 28,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--card)",
                      color: "var(--mid)",
                      border: "1px solid var(--line-hi)",
                      cursor: "pointer",
                    }}
                    title="Refresh browser source (no cache)"
                    aria-label="Refresh browser source"
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remove "${it.sourceName}" from ${sceneName}?`,
                      message:
                        "Detaches the source from this scene. The source itself is not deleted.",
                      dangerous: true,
                      confirmLabel: "Remove",
                    });
                    if (!ok) return;
                    send({
                      action: "remove-scene-item",
                      sceneName,
                      sceneItemId: it.sceneItemId,
                    });
                  }}
                  className="font-mono"
                  style={{
                    width: 28,
                    height: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--card)",
                    color: "var(--pgm)",
                    border: "1px solid var(--pgm)",
                    cursor: "pointer",
                  }}
                  title="Remove from scene"
                  aria-label="Remove from scene"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </HairlineRow>
  );
}
