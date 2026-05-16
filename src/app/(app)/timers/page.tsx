"use client";

import { useMemo } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { TimerCard } from "@/components/timers/timer-card";
import { TopBar, Section } from "@/components/sw";

const TIMER_INPUT_TYPES = new Set(["Timer", "Countdown", "Clock", "GT"]);

export default function TimersPage() {
  const vmixState = useVmixStore((s) => s.vmixState);
  const connected = useVmixStore((s) => s.connected);

  const timerInputs = useMemo(
    () => vmixState?.inputs.filter((i) => TIMER_INPUT_TYPES.has(i.type)) ?? [],
    [vmixState?.inputs]
  );

  if (!connected || !vmixState) {
    return (
      <div className="flex flex-col">
        <TopBar status="offline" title="Timers" sub="no vmix" />
        <Section>
          <div className="text-[13px] text-sw-muted py-12 text-center">
            {!connected ? "Connect to vMix to use timers." : "Loading…"}
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <TopBar
        status="live"
        num="12"
        label="Timers"
        title={
          <>
            {timerInputs.length}{" "}
            <span className="text-sw-muted font-light">Counters.</span>
          </>
        }
        sub={`${timerInputs.length} timer${timerInputs.length !== 1 ? "s" : ""}`}
      />

      {timerInputs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 border-b-[1.5px] border-sw-line-2">
          {timerInputs.map((input) => (
            <TimerCard key={input.key} input={input} />
          ))}
        </div>
      ) : (
        <Section>
          <div className="text-[13px] text-sw-muted py-16 text-center">
            No timer inputs found in vMix.
          </div>
        </Section>
      )}
    </div>
  );
}
