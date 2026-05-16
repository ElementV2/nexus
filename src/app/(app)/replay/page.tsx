"use client";

import { useVmixStore } from "@/stores/vmix-store";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { ReplayTransport } from "@/components/replay/replay-transport";
import { ReplayChannels } from "@/components/replay/replay-channels";
import { ReplayEvents } from "@/components/replay/replay-events";
import { ReplayMarks } from "@/components/replay/replay-marks";
import {
  replayStartRecording,
  replayStopRecording,
  replayShowHide,
} from "@/lib/vmix/commands";
import {
  TopBar,
  Section,
  Eyebrow,
  ButtonGroup,
  Cell,
  StatusPill,
  ToolbarSlot,
} from "@/components/sw";

export default function ReplayPage() {
  const connected = useVmixStore((s) => s.connected);
  // Narrow selectors — page only needs the replay block + the single
  // Replay input (there is at most one). Avoids re-rendering on every
  // unrelated audio/colour update.
  const replay = useVmixStore((s) => s.vmixState?.replay ?? null);
  const replayInput = useVmixStore(
    (s) => s.vmixState?.inputs.find((i) => i.type === "Replay") ?? undefined
  );
  const send = useVmixCommand();

  if (!connected || !replay) {
    return (
      <div className="flex flex-col">
        <TopBar status="offline" num="07" label="Buffer" title="Replay" sub="no vmix" />
        <Section>
          <div className="text-[13px] text-sw-muted py-12 text-center">
            {!connected
              ? "Connect to vMix to use the replay controller."
              : "Loading…"}
          </div>
        </Section>
      </div>
    );
  }

  const channelTone =
    replay.channelMode === "A"
      ? "red"
      : replay.channelMode === "B"
        ? "blue"
        : "purple";

  return (
    <div className="flex flex-col">
      <TopBar
        // `status` tracks vMix connection (consistent with every
        // other page). The recording state is communicated via the
        // title + the recording pill in the right slot below — not
        // by faking the connection status.
        status="live"
        num="07"
        label="Buffer"
        title={
          replay.recording ? (
            <>Recording.</>
          ) : (
            <>
              {replay.events}{" "}
              <span className="text-sw-muted font-light">Events.</span>
            </>
          )
        }
        sub={replayInput?.title ?? "no replay input found"}
        right={
          <>
            <ToolbarSlot label="CH">
              <StatusPill role={channelTone} variant="solid">
                {replay.channelMode}
              </StatusPill>
            </ToolbarSlot>
            <ToolbarSlot label="SPD · CAM · EVT">
              <span className="font-mono text-[11px] text-sw-text-dim leading-tight">
                A {replay.speedA.toFixed(2)}× · cam {replay.cameraA} · evt {replay.eventsA}
                <br />
                <span className="text-sw-blue">
                  B {replay.speedB.toFixed(2)}× · cam {replay.cameraB} · evt {replay.eventsB}
                </span>
              </span>
            </ToolbarSlot>
            <ToolbarSlot label="Actions">
              <ButtonGroup>
                <Cell
                  active={replay.recording}
                  role="red"
                  onClick={() =>
                    send(
                      replay.recording ? replayStopRecording() : replayStartRecording()
                    )
                  }
                >
                  {replay.recording ? "● Rec" : "○ Rec"}
                </Cell>
                <Cell onClick={() => send(replayShowHide())}>◐ Show / Hide</Cell>
              </ButtonGroup>
            </ToolbarSlot>
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 border-b-[1.5px] border-sw-line-2">
        <Pane num="01" label="Transport" rightBorder>
          <ReplayTransport replay={replay} replayInput={replayInput} />
          <div className="mt-6">
            <Eyebrow tone="muted" className="mb-3">Channels &amp; Cameras</Eyebrow>
            <ReplayChannels replay={replay} />
          </div>
        </Pane>
        <Pane num="02" label="Mark In / Out" rightBorder>
          <ReplayMarks replay={replay} />
        </Pane>
        <Pane num="03" label="Events">
          <ReplayEvents replay={replay} />
        </Pane>
      </div>
    </div>
  );
}

function Pane({
  num,
  label,
  children,
  rightBorder,
}: {
  num: string;
  label: string;
  children: React.ReactNode;
  rightBorder?: boolean;
}) {
  return (
    <div
      className={
        "px-[24px] py-[18px] " +
        (rightBorder ? "xl:border-r-[1.5px] border-sw-line-2" : "")
      }
    >
      <div className="mb-4">
        <Eyebrow tone="amber">
          {num} <span className="text-sw-muted">·</span> {label}
        </Eyebrow>
      </div>
      {children}
    </div>
  );
}
