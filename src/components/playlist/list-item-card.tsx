"use client";

import { memo, useRef, useCallback, useEffect } from "react";
import { TransportControls } from "./transport-controls";
import { formatTime } from "@/lib/utils/time";
import { VuMeter } from "@/components/audio/vu-meter";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import { useOptimisticValue } from "@/hooks/use-optimistic-value";
import {
  selectIndex,
  nextItem,
  previousItem,
  setPosition,
  listRemove,
} from "@/lib/vmix/commands";
import { THROTTLE_RATE_MS } from "@/lib/vmix/constants";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import type { VmixInput } from "@/lib/vmix/types";

// ------------------------------------------------------------------
// ProgressSeek — clickable + draggable progress bar
// ------------------------------------------------------------------
function ProgressSeek({
  input,
  isMedia,
  progress,
  send,
}: {
  input: VmixInput;
  isMedia: boolean;
  progress: number;
  send: ReturnType<typeof useVmixCommand>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const disabled = !isMedia || input.duration <= 0;

  // Optimistic seek-bar override — same logic as the audio faders,
  // expressed via the shared useOptimisticValue hook. Works in
  // percent space (0..100) so display values, snapshot, and send all
  // share a single unit.
  const sendSeek = useCallback(
    (pct: number) => {
      if (input.duration <= 0) return;
      send(setPosition(input.number, (pct / 100) * input.duration));
    },
    [send, input.number, input.duration]
  );
  const {
    display: displayPct,
    isDragging,
    onChange: pushPct,
    onChangeStart: onSeekStart,
    onChangeEnd: commitPct,
  } = useOptimisticValue<number>(progress, sendSeek, {
    throttleMs: THROTTLE_RATE_MS,
    equals: (a, b) => Math.abs(a - b) < 0.5,
  });

  const pctFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return (
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100
    );
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      onSeekStart();
      pushPct(pctFromEvent(e));
    },
    [pctFromEvent, onSeekStart, pushPct]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      pushPct(pctFromEvent(e));
    },
    [pctFromEvent, pushPct]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      commitPct(pctFromEvent(e));
    },
    [pctFromEvent, commitPct]
  );

  const displayTime = isDragging
    ? (displayPct / 100) * input.duration
    : input.position;

  return (
    <div
      className="space-y-1"
      style={{
        opacity: disabled ? 0.25 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {/* Track */}
      <div
        ref={trackRef}
        className="relative flex items-center cursor-pointer touch-none"
        style={{ height: 22 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="absolute inset-x-0"
          style={{
            top: 8,
            height: 6,
            background: "var(--card)",
            border: "1px solid var(--line-hi)",
          }}
        />
        <div
          className="absolute"
          style={{
            top: 9,
            bottom: 9,
            left: 0,
            width: `${displayPct}%`,
            background: "var(--cyan)",
            opacity: 0.85,
          }}
        />
        {/* Playhead cap */}
        <div
          className="absolute flex items-center justify-center"
          style={{
            left: `${displayPct}%`,
            top: 4,
            width: 14,
            height: 14,
            marginLeft: -7,
            gap: 2,
            background: "var(--ink)",
            border: "1px solid var(--bg)",
            pointerEvents: "none",
          }}
        >
          <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
          <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
          <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
        </div>
      </div>
      {/* Times */}
      <div
        className="flex justify-between font-mono tabular-nums"
        style={{ fontSize: 10, color: "var(--muted)" }}
      >
        <span style={{ color: isDragging ? "var(--cyan)" : "inherit" }}>
          {formatTime(displayTime)}
        </span>
        <span>-{formatTime(Math.max(0, input.duration - displayTime))}</span>
      </div>
    </div>
  );
}

interface ListItemCardProps {
  input: VmixInput;
}

function ListItemCardImpl({ input }: ListItemCardProps) {
  const send = useVmixCommand();
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [input.selectedIndex]);

  const isMedia =
    input.type === "Video" ||
    input.type === "AudioFile" ||
    input.type === "VideoList" ||
    input.type === "Photos";

  const progress =
    input.duration > 0 ? (input.position / input.duration) * 100 : 0;

  const statePillFg =
    input.state === "Running"
      ? "var(--pvw)"
      : input.state === "Paused"
        ? "var(--amber)"
        : "var(--muted)";
  const statePillBg =
    input.state === "Running"
      ? "var(--pvw-tint)"
      : input.state === "Paused"
        ? "var(--amber-tint)"
        : "var(--card)";

  return (
    <div
      style={{
        padding: 12,
        background: "var(--card)",
        border: "1px solid var(--line)",
      }}
      className="space-y-2"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="flex items-center justify-center font-mono tabular-nums shrink-0"
            style={{
              width: 22,
              height: 22,
              fontSize: 10,
              fontWeight: 700,
              background: "var(--panel-2)",
              color: "var(--mid)",
              border: "1px solid var(--line)",
            }}
          >
            {input.number}
          </span>
          <div className="min-w-0">
            <div
              className="truncate"
              style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
            >
              {input.title}
            </div>
            <div className="label" style={{ fontSize: 9 }}>
              {input.type}
            </div>
          </div>
        </div>

        <span
          className="font-mono uppercase shrink-0"
          style={{
            padding: "2px 8px",
            fontSize: 9,
            letterSpacing: "1.4px",
            fontWeight: 700,
            background: statePillBg,
            color: statePillFg,
            border: `1px solid ${statePillFg}`,
          }}
        >
          {input.state || "Idle"}
        </span>
      </div>

      {/* Remaining time */}
      <div className="flex items-baseline gap-2">
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.5px",
            lineHeight: 1,
            color: isMedia && input.duration > 0 ? "var(--ink)" : "var(--sub)",
          }}
        >
          -
          {isMedia && input.duration > 0
            ? formatTime(Math.max(0, input.duration - input.position))
            : "00:00:00"}
        </span>
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: 10,
            color: isMedia && input.duration > 0 ? "var(--muted)" : "var(--sub)",
          }}
        >
          /{" "}
          {isMedia && input.duration > 0
            ? formatTime(input.duration)
            : "00:00:00"}
        </span>
      </div>

      {/* VU meters */}
      <div className="space-y-1">
        <VuMeter amplitude={input.meterF1} muted={input.muted} />
        <VuMeter amplitude={input.meterF2} muted={input.muted} />
      </div>

      {/* Progress + transport */}
      <div
        style={{
          visibility: isMedia && input.duration > 0 ? "visible" : "hidden",
          pointerEvents: isMedia && input.duration > 0 ? "auto" : "none",
        }}
        className="space-y-2"
      >
        <ProgressSeek
          input={input}
          isMedia={isMedia}
          progress={progress}
          send={send}
        />
        <TransportControls input={input} />
      </div>

      {/* List items */}
      {input.items &&
        input.items.length > 0 &&
        (() => {
          const selectedIdx = input.items.findIndex((i) => i.selected);
          const currentNum = selectedIdx >= 0 ? selectedIdx + 1 : 0;
          const total = input.items.length;
          const itemsRemaining =
            selectedIdx >= 0 ? total - selectedIdx - 1 : 0;
          const isFirst = selectedIdx <= 0;
          const isLast = selectedIdx >= total - 1;

          return (
            <div className="space-y-2">
              {/* List progress */}
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--ink)",
                    }}
                  >
                    {currentNum}
                    <span style={{ color: "var(--muted)" }}>/{total}</span>
                  </span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>
                    {itemsRemaining > 0 ? (
                      <>
                        <span className="font-mono tabular-nums">
                          {itemsRemaining}
                        </span>{" "}
                        remaining
                      </>
                    ) : (
                      "last item"
                    )}
                  </span>
                </div>
                <div className="flex gap-px">
                  {input.items.map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        height: 4,
                        width: idx === selectedIdx ? 12 : 4,
                        background:
                          idx === selectedIdx
                            ? "var(--cyan)"
                            : idx < selectedIdx
                              ? "var(--mid)"
                              : "var(--line-hi)",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Prev / Next — collés bar */}
              <div className="inline-flex w-full">
                <ListNavButton
                  onClick={() => send(previousItem(input.number))}
                  disabled={isFirst}
                  position="first"
                >
                  <ChevronUp size={14} strokeWidth={1.6} /> Prev
                </ListNavButton>
                <ListNavButton
                  onClick={() => send(nextItem(input.number))}
                  disabled={isLast}
                  position="last"
                >
                  Next <ChevronDown size={14} strokeWidth={1.6} />
                </ListNavButton>
              </div>

              {/* Item list */}
              <div
                ref={listRef}
                className="overflow-y-auto"
                style={{
                  maxHeight: 280,
                  border: "1px solid var(--line)",
                  background: "var(--panel-2)",
                }}
              >
                {input.items.map((item, idx) => {
                  const fileName =
                    item.source.split(/[\\/]/).pop() || item.source;
                  const isSelected = item.selected;
                  return (
                    <div
                      key={`${item.source}-${idx}`}
                      ref={isSelected ? selectedRef : undefined}
                      className="group flex items-center"
                      style={{
                        background: isSelected ? "var(--cyan-tint)" : "transparent",
                        borderBottom: "1px solid var(--line)",
                        borderLeft: isSelected
                          ? "2px solid var(--cyan)"
                          : "2px solid transparent",
                      }}
                    >
                      <button
                        onClick={() =>
                          send(selectIndex(input.number, idx + 1))
                        }
                        className="flex-1 min-w-0 text-left truncate transition-colors"
                        style={{
                          padding: "6px 10px",
                          fontSize: 11,
                          color: isSelected ? "var(--ink)" : "var(--mid)",
                          fontWeight: isSelected ? 600 : 400,
                          transitionDuration: "80ms",
                        }}
                      >
                        <span
                          className="font-mono tabular-nums"
                          style={{
                            marginRight: 6,
                            color: isSelected ? "var(--cyan)" : "var(--sub)",
                          }}
                        >
                          {idx + 1}.
                        </span>
                        {fileName}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          send(listRemove(input.number, idx + 1));
                        }}
                        className="shrink-0 transition-colors"
                        style={{
                          padding: 6,
                          color: "var(--sub)",
                          transitionDuration: "80ms",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = "var(--pgm)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = "var(--sub)";
                        }}
                        title="Remove from list"
                      >
                        <X size={12} strokeWidth={1.6} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
    </div>
  );
}

export const ListItemCard = memo(ListItemCardImpl);

function ListNavButton({
  children,
  onClick,
  disabled,
  position,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  position?: "first" | "last";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center font-mono uppercase transition-colors"
      style={{
        flex: 1,
        gap: 4,
        height: 28,
        fontSize: 11,
        letterSpacing: "1.4px",
        fontWeight: 600,
        background: "var(--card)",
        color: disabled ? "var(--sub)" : "var(--mid)",
        borderTop: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
        borderRight: "1px solid var(--line)",
        borderLeft: position === "first" ? "1px solid var(--line)" : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transitionDuration: "80ms",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "var(--card-hi)";
          e.currentTarget.style.color = "var(--ink)";
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "var(--card)";
          e.currentTarget.style.color = "var(--mid)";
        }
      }}
    >
      {children}
    </button>
  );
}
