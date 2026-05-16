"use client";

import { useVmixCommand } from "@/hooks/use-vmix-command";
import type { VmixReplay } from "@/lib/vmix/types";
import {
  replayMarkInLive,
  replayMarkInRecorded,
  replayMarkOut,
  replayMarkCancel,
  replayMarkInOutLive,
  replayMarkInOutRecorded,
  replayMoveSelectedInPoint,
  replayMoveSelectedOutPoint,
  replayUpdateSelectedInPoint,
  replayUpdateSelectedOutPoint,
  replayJumpToSelectedInPoint,
  replayJumpToSelectedOutPoint,
  replayLiveToggle,
} from "@/lib/vmix/commands";
import {
  ButtonGroup,
  Cell,
  Eyebrow,
  NumberPad,
} from "@/components/sw";

const QUICK_MARK_SECONDS = [5, 10, 15, 20, 30, 60];
const FRAME_NUDGES = [-30, -10, -5, -1, 1, 5, 10, 30];

interface ReplayMarksProps {
  replay: VmixReplay;
}

export function ReplayMarks({ replay }: ReplayMarksProps) {
  const send = useVmixCommand();
  const isLive = replay.live;

  return (
    <div className="space-y-5">
      {/* Timeline source — switches every mark/quick-mark below
          between vMix's Live timeline and its Recorded timeline. */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Timeline</Eyebrow>
        <ButtonGroup>
          <Cell
            active={isLive}
            role="green"
            onClick={() => !isLive && send(replayLiveToggle())}
            className="flex-1 h-[44px] text-[12px]"
          >
            ● Live Timeline
          </Cell>
          <Cell
            active={!isLive}
            role="amber"
            onClick={() => isLive && send(replayLiveToggle())}
            className="flex-1 h-[44px] text-[12px]"
          >
            ● Record Timeline
          </Cell>
        </ButtonGroup>
      </div>

      {/* Mark IN / OUT — operates on the timeline selected above */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Mark Points</Eyebrow>
        <div className="grid grid-cols-2 pr-px pb-px">
          <Cell
            active
            role="green"
            onClick={() => send(isLive ? replayMarkInLive() : replayMarkInRecorded())}
            className="h-[48px] text-[13px]"
          >
            ↤ Mark In
          </Cell>
          <Cell
            active
            role="red"
            onClick={() => send(replayMarkOut())}
            className="h-[48px] text-[13px]"
          >
            Mark Out ↦
          </Cell>
        </div>
        <Cell
          onClick={() => send(replayMarkCancel())}
          className="w-full h-[32px] text-[11px]"
        >
          ✕ Clear Marks
        </Cell>
      </div>

      {/* Quick mark last N seconds */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Quick Mark · Last N sec</Eyebrow>
        <NumberPad
          values={QUICK_MARK_SECONDS.map((s) => `${s}s`)}
          cols={6}
          role="blue"
          onSelect={(v) => {
            const n = parseInt(String(v));
            send(isLive ? replayMarkInOutLive(n) : replayMarkInOutRecorded(n));
          }}
        />
      </div>

      {/* Trim points */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Trim In/Out Points · Frames</Eyebrow>
        <div className="flex items-stretch">
          <div className="w-[40px] border-[1px] border-sw-line-2 -mr-px flex items-center justify-center font-mono text-[10px] text-sw-muted">
            IN
          </div>
          <div className="flex-1">
            <NumberPad
              values={FRAME_NUDGES.map((f) => (f > 0 ? `+${f}` : `${f}`))}
              cols={8}
              onSelect={(v) => send(replayMoveSelectedInPoint(parseInt(String(v))))}
            />
          </div>
        </div>
        <div className="flex items-stretch">
          <div className="w-[40px] border-[1px] border-sw-line-2 -mr-px flex items-center justify-center font-mono text-[10px] text-sw-muted">
            OUT
          </div>
          <div className="flex-1">
            <NumberPad
              values={FRAME_NUDGES.map((f) => (f > 0 ? `+${f}` : `${f}`))}
              cols={8}
              onSelect={(v) => send(replayMoveSelectedOutPoint(parseInt(String(v))))}
            />
          </div>
        </div>
      </div>

      {/* Update / Jump */}
      <ButtonGroup>
        <Cell
          onClick={() => send(replayUpdateSelectedInPoint())}
          className="flex-1 h-[36px] text-[11px]"
        >
          ← Update In
        </Cell>
        <Cell
          onClick={() => send(replayUpdateSelectedOutPoint())}
          className="flex-1 h-[36px] text-[11px]"
        >
          Update Out →
        </Cell>
      </ButtonGroup>
      <ButtonGroup>
        <Cell
          onClick={() => send(replayJumpToSelectedInPoint())}
          className="flex-1 h-[36px] text-[11px]"
        >
          ● Jump to In
        </Cell>
        <Cell
          onClick={() => send(replayJumpToSelectedOutPoint())}
          className="flex-1 h-[36px] text-[11px]"
        >
          Jump to Out ●
        </Cell>
      </ButtonGroup>
    </div>
  );
}
