"use client";

import { useVmixCommand } from "@/hooks/use-vmix-command";
import type { VmixReplay } from "@/lib/vmix/types";
import {
  replaySelectChannelA,
  replaySelectChannelB,
  replaySelectChannelAB,
  replayCamera,
  replayActiveCamera,
} from "@/lib/vmix/commands";
import { ButtonGroup, Cell, Eyebrow, NumberPad } from "@/components/sw";

const CHANNELS = ["A", "B", "C", "D"] as const;

interface ReplayChannelsProps {
  replay: VmixReplay;
}

export function ReplayChannels({ replay }: ReplayChannelsProps) {
  const send = useVmixCommand();

  return (
    <div className="space-y-5">
      {/* Active channel */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Active channel</Eyebrow>
        <ButtonGroup>
          <Cell
            active={replay.channelMode === "A"}
            role="red"
            onClick={() => send(replaySelectChannelA())}
            className="flex-1 h-[36px] text-[14px]"
          >
            A
          </Cell>
          <Cell
            active={replay.channelMode === "B"}
            role="blue"
            onClick={() => send(replaySelectChannelB())}
            className="flex-1 h-[36px] text-[14px]"
          >
            B
          </Cell>
          <Cell
            active={replay.channelMode === "AB"}
            role="purple"
            onClick={() => send(replaySelectChannelAB())}
            className="flex-1 h-[36px] text-[14px]"
          >
            AB
          </Cell>
        </ButtonGroup>
      </div>

      {/* Camera grid per channel */}
      {CHANNELS.map((ch) => {
        const tone =
          ch === "A" ? "red" : ch === "B" ? "blue" : ch === "C" ? "green" : "amber";
        const active =
          ch === "A" ? replay.cameraA : ch === "B" ? replay.cameraB : null;
        return (
          <div key={ch} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <Eyebrow tone={tone}>{ch} · Cameras</Eyebrow>
            </div>
            <NumberPad
              values={[1, 2, 3, 4, 5, 6, 7, 8]}
              cols={8}
              active={active ?? undefined}
              role={tone}
              onSelect={(v) => send(replayCamera(ch, Number(v)))}
            />
          </div>
        );
      })}

      {/* Active channel quick cams */}
      <div className="space-y-2">
        <Eyebrow tone="purple">Active channel · cameras</Eyebrow>
        <NumberPad
          values={[1, 2, 3, 4, 5, 6, 7, 8]}
          cols={8}
          role="purple"
          onSelect={(v) => send(replayActiveCamera(Number(v)))}
        />
      </div>
    </div>
  );
}
