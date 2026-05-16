"use client";

import { useState } from "react";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import type { VmixReplay } from "@/lib/vmix/types";
import {
  replaySelectEvents,
  replaySelectFirstEvent,
  replaySelectLastEvent,
  replaySelectNextEvent,
  replaySelectPreviousEvent,
  replaySelectAllEvents,
  replayPlaySelectedEvent,
  replayPlaySelectedEventToOutput,
  replayPlayLastEvent,
  replayPlayLastEventToOutput,
  replayPlayAllEvents,
  replayPlayAllEventsToOutput,
  replayMoveSelectedEventUp,
  replayMoveSelectedEventDown,
  replayCopySelectedEvent,
  replayDeleteSelectedEvent,
  replayDuplicateSelectedEvent,
  replayExportLastEvent,
  replaySetSelectedEventText,
  replayToggleSelectedEventCamera,
  replayToggleLastEventCamera,
} from "@/lib/vmix/commands";
import {
  ButtonGroup,
  Cell,
  Eyebrow,
  NumberPad,
  MonoInput,
  SetButton,
} from "@/components/sw";

interface ReplayEventsProps {
  replay: VmixReplay;
}

export function ReplayEvents({ replay }: ReplayEventsProps) {
  const send = useVmixCommand();
  const [selectedEvent, setSelectedEvent] = useState(1);
  const [eventText, setEventText] = useState("");
  const [exportFolder, setExportFolder] = useState("");

  const handleSelectEvent = (num: number) => {
    setSelectedEvent(num);
    send(replaySelectEvents(num));
  };

  return (
    <div className="space-y-5">
      {/* Event grid 1-20 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Eyebrow tone="muted">Event Lists</Eyebrow>
          <span className="font-mono text-[10px] text-sw-muted">
            {replay.events} total · A:{replay.eventsA} · B:{replay.eventsB}
          </span>
        </div>
        <NumberPad
          values={Array.from({ length: 20 }, (_, i) => i + 1)}
          cols={10}
          active={selectedEvent}
          role="blue"
          onSelect={(v) => handleSelectEvent(Number(v))}
        />
      </div>

      {/* Navigation */}
      <ButtonGroup>
        <Cell onClick={() => send(replaySelectFirstEvent())} className="flex-1">
          ◀◀ First
        </Cell>
        <Cell onClick={() => send(replaySelectPreviousEvent())} className="flex-1">
          ◀ Prev
        </Cell>
        <Cell onClick={() => send(replaySelectNextEvent())} className="flex-1">
          Next ▶
        </Cell>
        <Cell onClick={() => send(replaySelectLastEvent())} className="flex-1">
          Last ▶▶
        </Cell>
        <Cell onClick={() => send(replaySelectAllEvents())} className="flex-1">
          ✓ All
        </Cell>
      </ButtonGroup>

      {/* Playback */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Playback</Eyebrow>
        <div className="grid grid-cols-2 pr-px pb-px">
          <Cell
            active
            role="green"
            onClick={() => send(replayPlaySelectedEvent())}
            className="h-[36px] text-[12px]"
          >
            ▶ Play Selected
          </Cell>
          <Cell
            active
            role="green"
            onClick={() => send(replayPlaySelectedEventToOutput())}
            className="h-[36px] text-[12px]"
          >
            Selected → Out
          </Cell>
          <Cell
            active
            role="blue"
            onClick={() => send(replayPlayLastEvent())}
            className="h-[36px] text-[12px]"
          >
            ▶ Play Last
          </Cell>
          <Cell
            active
            role="blue"
            onClick={() => send(replayPlayLastEventToOutput())}
            className="h-[36px] text-[12px]"
          >
            Last → Out
          </Cell>
          <Cell
            active
            role="purple"
            onClick={() => send(replayPlayAllEvents())}
            className="h-[36px] text-[12px]"
          >
            ▶ Play All
          </Cell>
          <Cell
            active
            role="purple"
            onClick={() => send(replayPlayAllEventsToOutput())}
            className="h-[36px] text-[12px]"
          >
            All → Out
          </Cell>
        </div>
      </div>

      {/* Event management */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Event management</Eyebrow>
        <ButtonGroup>
          <Cell onClick={() => send(replayMoveSelectedEventUp())} className="flex-1">
            ↑ Up
          </Cell>
          <Cell onClick={() => send(replayMoveSelectedEventDown())} className="flex-1">
            ↓ Down
          </Cell>
          <Cell
            onClick={() => send(replayCopySelectedEvent(selectedEvent))}
            className="flex-1"
          >
            ⎘ Copy
          </Cell>
          <Cell
            onClick={() => send(replayDuplicateSelectedEvent(selectedEvent))}
            className="flex-1"
          >
            ⊕ Dup
          </Cell>
          <Cell
            active
            role="red"
            onClick={() => send(replayDeleteSelectedEvent(selectedEvent))}
            className="flex-1"
          >
            ⌫ Delete
          </Cell>
        </ButtonGroup>
      </div>

      {/* Camera toggles */}
      <div className="space-y-3">
        <Eyebrow tone="muted">Toggle Event Cameras</Eyebrow>
        <div className="space-y-2">
          <Eyebrow tone="green">Selected event</Eyebrow>
          <NumberPad
            values={[1, 2, 3, 4, 5, 6, 7, 8]}
            cols={8}
            role="green"
            onSelect={(v) => send(replayToggleSelectedEventCamera(Number(v)))}
          />
        </div>
        <div className="space-y-2">
          <Eyebrow tone="blue">Last event</Eyebrow>
          <NumberPad
            values={[1, 2, 3, 4, 5, 6, 7, 8]}
            cols={8}
            role="blue"
            onSelect={(v) => send(replayToggleLastEventCamera(Number(v)))}
          />
        </div>
      </div>

      {/* Event text */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Event text</Eyebrow>
        <div className="flex">
          <MonoInput
            value={eventText}
            onChange={(e) => setEventText(e.target.value)}
            placeholder="Event label…"
            className="flex-1"
          />
          <SetButton
            onClick={() => {
              if (eventText.trim()) send(replaySetSelectedEventText(eventText));
            }}
          >
            Set
          </SetButton>
        </div>
      </div>

      {/* Export */}
      <div className="space-y-2">
        <Eyebrow tone="muted">Export last event</Eyebrow>
        <div className="flex">
          <MonoInput
            value={exportFolder}
            onChange={(e) => setExportFolder(e.target.value)}
            placeholder="Folder name…"
            className="flex-1"
          />
          <SetButton
            variant="red"
            onClick={() => {
              if (exportFolder.trim()) send(replayExportLastEvent(exportFolder));
            }}
          >
            Export
          </SetButton>
        </div>
      </div>
    </div>
  );
}
