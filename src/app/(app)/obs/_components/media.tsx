"use client";

import { useMemo } from "react";
import {
  Play,
  Square,
  Pause,
  RotateCw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useObsStore } from "@/stores/obs-store";
import { useObsCommand } from "@/hooks/use-obs-command";
import { Section, Eyebrow, HairlineRow } from "@/components/sw";

/* ── Media inputs row ───────────────────────────────────────── */

const MEDIA_KINDS = new Set([
  "ffmpeg_source",
  "vlc_source",
  "slideshow",
]);

export function MediaInputsRow() {
  const inputs = useObsStore((s) => s.snapshot?.inputs ?? []);
  const mediaInputs = useMemo(
    () =>
      inputs.filter((i) =>
        MEDIA_KINDS.has(i.unversionedInputKind ?? i.inputKind)
      ),
    [inputs]
  );
  const send = useObsCommand();
  if (mediaInputs.length === 0) return null;

  return (
    <Section>
      <Eyebrow tone="amber" className="mb-3">
        Media
      </Eyebrow>
      {mediaInputs.map((m) => (
        <HairlineRow
          key={m.inputName}
          className="flex items-center"
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              className="font-mono"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              {m.inputName}
            </span>
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                color: "var(--sub)",
                marginLeft: 8,
              }}
            >
              {m.inputKind}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <MediaButton
              onClick={() =>
                send({
                  action: "trigger-media",
                  inputName: m.inputName,
                  mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
                })
              }
              title="Restart"
            >
              <RotateCw size={13} />
            </MediaButton>
            <MediaButton
              onClick={() =>
                send({
                  action: "trigger-media",
                  inputName: m.inputName,
                  mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS",
                })
              }
              title="Previous"
            >
              <SkipBack size={13} />
            </MediaButton>
            <MediaButton
              onClick={() =>
                send({
                  action: "trigger-media",
                  inputName: m.inputName,
                  mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
                })
              }
              title="Play"
            >
              <Play size={13} />
            </MediaButton>
            <MediaButton
              onClick={() =>
                send({
                  action: "trigger-media",
                  inputName: m.inputName,
                  mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE",
                })
              }
              title="Pause"
            >
              <Pause size={13} />
            </MediaButton>
            <MediaButton
              onClick={() =>
                send({
                  action: "trigger-media",
                  inputName: m.inputName,
                  mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT",
                })
              }
              title="Next"
            >
              <SkipForward size={13} />
            </MediaButton>
            <MediaButton
              onClick={() =>
                send({
                  action: "trigger-media",
                  inputName: m.inputName,
                  mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP",
                })
              }
              title="Stop"
            >
              <Square size={13} />
            </MediaButton>
          </div>
        </HairlineRow>
      ))}
    </Section>
  );
}

function MediaButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="font-mono"
      style={{
        width: 26,
        height: 26,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--card)",
        color: "var(--mid)",
        border: "1px solid var(--line-hi)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
