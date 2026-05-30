"use client";

import { useEffect, useState } from "react";
import { useObsStore } from "@/stores/obs-store";
import { useObsCommand } from "@/hooks/use-obs-command";
import {
  TopBar,
  Section,
  StatusPill,
  ToolbarSlot,
} from "@/components/sw";
import { TopHeaderBar, SpecialInputsRow } from "./_components/header-bar";
import {
  OutputsBar,
  ExtrasBar,
  OutputsCustomPanel,
  StatsFooter,
} from "./_components/outputs";
import {
  SceneCrudBar,
  SceneGrid,
  SceneInspector,
} from "./_components/scenes";
import { AudioMixer } from "./_components/audio";
import { MediaInputsRow } from "./_components/media";
import {
  FiltersDrawer,
  ProfilesAndCollections,
  HotkeyRunner,
} from "./_components/scene-extras";

/* ── Page ────────────────────────────────────────────────────── */

export default function ObsPage() {
  const status = useObsStore((s) => s.status);
  const obsVersion = useObsStore((s) => s.obsVersion);
  const snapshot = useObsStore((s) => s.snapshot);
  const stats = useObsStore((s) => s.stats);
  const lastReplayPath = useObsStore((s) => s.lastReplayPath);
  const send = useObsCommand();

  const [selectedSceneName, setSelectedSceneName] = useState<string | null>(
    null
  );

  // Promote scene selection to the program-scene's name when nothing
  // is explicitly selected, so the inspector has something to show.
  const inspectorScene =
    selectedSceneName ?? snapshot?.currentProgramSceneName ?? null;

  // Fetch scene items the first time the user opens a scene we
  // haven't cached yet.
  useEffect(() => {
    if (!inspectorScene || !snapshot) return;
    if (snapshot.sceneItemsByScene[inspectorScene]) return;
    send({ action: "ensure-scene-items", sceneName: inspectorScene });
  }, [inspectorScene, snapshot, send]);

  if (status !== "connected" || !snapshot) {
    return (
      <div className="flex flex-col">
        <TopBar
          status="offline"
          num="11"
          label="OBS WebSocket"
          title="OBS"
          sub={status === "disconnected" ? "no obs" : status}
        />
        <Section>
          <div className="text-[13px] text-sw-muted py-12 text-center">
            {status === "connecting" || status === "authenticating"
              ? `Status: ${status}…`
              : "Configure OBS in Network › Connections, then start obs-websocket inside OBS."}
          </div>
        </Section>
      </div>
    );
  }

  const studio = snapshot.studioModeEnabled;
  const pgm = snapshot.currentProgramSceneName;
  const pvw = snapshot.currentPreviewSceneName;

  return (
    <div className="flex flex-col">
      <TopBar
        status="live"
        num="11"
        label={`OBS ${obsVersion ?? ""}`}
        title={
          pgm ? (
            <>
              {pgm} <span className="text-sw-muted font-light">.</span>
            </>
          ) : (
            <>OBS.</>
          )
        }
        sub={
          studio
            ? `program ${pgm ?? "—"} · preview ${pvw ?? "—"}`
            : `${snapshot.scenes.length} scenes · live`
        }
        right={
          <>
            <ToolbarSlot label="Stream">
              <StatusPill
                role={snapshot.stream.active ? "red" : "muted"}
                variant={snapshot.stream.active ? "solid" : undefined}
              >
                {snapshot.stream.active ? "ON" : "OFF"}
              </StatusPill>
            </ToolbarSlot>
            <ToolbarSlot label="Record">
              <StatusPill
                role={
                  snapshot.record.active && !snapshot.record.paused
                    ? "red"
                    : snapshot.record.paused
                      ? "amber"
                      : "muted"
                }
                variant={snapshot.record.active ? "solid" : undefined}
              >
                {snapshot.record.paused
                  ? "PAUSE"
                  : snapshot.record.active
                    ? "REC"
                    : "OFF"}
              </StatusPill>
            </ToolbarSlot>
          </>
        }
      />

      <TopHeaderBar />
      <SpecialInputsRow />
      <OutputsBar />
      <SceneCrudBar
        selected={selectedSceneName}
        onCreated={(name) => setSelectedSceneName(name)}
      />
      <SceneGrid
        scenes={snapshot.scenes}
        pgm={pgm}
        pvw={pvw}
        studio={studio}
        onSelect={setSelectedSceneName}
        selected={inspectorScene}
      />

      {inspectorScene && (
        <SceneInspector
          sceneName={inspectorScene}
          isPgm={inspectorScene === pgm}
          isPvw={inspectorScene === pvw}
        />
      )}

      <AudioMixer />

      <ExtrasBar />

      <OutputsCustomPanel />

      <MediaInputsRow />

      {/* key=sceneName: remount on scene change so the filters cache
          (per-source list state and the "we've fetched this source"
          ref) is reset cleanly without an explicit effect. */}
      <FiltersDrawer key={inspectorScene ?? "_"} sceneName={inspectorScene} />

      <ProfilesAndCollections />

      <HotkeyRunner />

      <StatsFooter stats={stats} />

      {lastReplayPath && (
        <div
          className="font-mono"
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            padding: "8px 12px",
            background: "var(--pvw-tint)",
            color: "var(--pvw)",
            border: "1px solid var(--pvw)",
            fontSize: 11,
            maxWidth: 360,
            wordBreak: "break-all",
          }}
        >
          ✓ Replay saved · {lastReplayPath}
        </div>
      )}
    </div>
  );
}
