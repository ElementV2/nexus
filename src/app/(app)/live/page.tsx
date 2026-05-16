"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVmixStore } from "@/stores/vmix-store";
import { useVmixCommand } from "@/hooks/use-vmix-command";
import {
  transitionInput,
  previewInput,
  setOutput,
  setOutputSource,
  overlayInput,
  pvwTransition,
} from "@/lib/vmix/commands";
import {
  OUTPUT_OPTIONS,
  OVERLAY_CHANNELS,
  STINGER_CHANNELS,
} from "@/lib/vmix/constants";
import {
  buildTransitionOptions,
  type TransitionOption,
} from "@/components/playlist/output-buttons";
import { LiveHeader } from "@/components/live/live-header";
import { TopBar, Section } from "@/components/sw";
import { InputCell, CollapsedInputCell } from "@/components/live/input-cell";
import { DetailsPanel } from "@/components/live/details-panel";
import { RouteModeBar } from "@/components/live/route-mode-bar";
import {
  routeTargetId,
  type MixInfo,
  type RouteTarget,
  type TallyInfo,
  type TransitionButton,
} from "@/components/live/helpers";

const DEFAULT_TRANSITION: TransitionButton = { label: "Cut", fn: "Cut" };

// SSR-safe localStorage readers used by the hydration effects below.
// Only ever invoked from inside useEffect (client-side), so no `typeof
// window` guard is needed. Each returns a fresh default on missing /
// corrupt input so the caller can unconditionally pass the result to
// setState.

function readHiddenTilesFromStorage(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr.filter(
        (n: unknown): n is number =>
          typeof n === "number" && Number.isFinite(n)
      )
    );
  } catch {
    return new Set();
  }
}

function readArmedTargetIdsFromStorage(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr.filter(
        (x: unknown): x is string => typeof x === "string" && x.length > 0
      )
    );
  } catch {
    return new Set();
  }
}

function readSelectedTransitionFromStorage(key: string): TransitionButton {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_TRANSITION;
    const obj = JSON.parse(raw) as unknown;
    if (
      !obj ||
      typeof obj !== "object" ||
      typeof (obj as { fn?: unknown }).fn !== "string" ||
      typeof (obj as { label?: unknown }).label !== "string"
    ) {
      return DEFAULT_TRANSITION;
    }
    const safe = obj as {
      label: string;
      fn: string;
      duration?: unknown;
      hint?: unknown;
    };
    return {
      label: safe.label,
      fn: safe.fn,
      duration: typeof safe.duration === "number" ? safe.duration : undefined,
      hint: typeof safe.hint === "string" ? safe.hint : undefined,
    };
  } catch {
    return DEFAULT_TRANSITION;
  }
}

function readTransitionDurationsFromStorage(
  key: string
): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export default function LivePage() {
  const vmixState = useVmixStore((s) => s.vmixState);
  const connected = useVmixStore((s) => s.connected);
  const vmixHost = useVmixStore((s) => s.vmixHost);
  const vmixPort = useVmixStore((s) => s.vmixPort);
  const send = useVmixCommand();

  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [hiddenTiles, setHiddenTiles] = useState<Set<number>>(new Set());
  const [selectedDetails, setSelectedDetails] = useState<number | null>(null);
  // Destination set the operator has armed via the TAP bar. Click on
  // any input fans the input out to every armed destination at once.
  const [armedTargetIds, setArmedTargetIds] = useState<Set<string>>(
    () => new Set()
  );
  // Transition armed via the top header. Used ONLY for PGM and MIX
  // destinations — OUT and OVL routings ignore it (vMix takes no
  // transition argument for those). Default Cut so a click on a tile
  // with no transition tweak goes through instantly.
  const [selectedTransition, setSelectedTransition] = useState<TransitionButton>({
    label: "Cut",
    fn: "Cut",
  });
  // Per-fn duration override (right-click on a transition button in
  // the LiveHeader to edit). Falls back to TransitionButton.duration
  // when no override is set. Keyed by vMix function name.
  const [transitionDurations, setTransitionDurations] = useState<
    Record<string, number>
  >({});

  // Persist UI state per vMix instance. Connecting to a different
  // host gives you a different input numbering and mix layout, so a
  // single global key would leak state across unrelated shows.
  // Namespace every persisted slice = `host:port`.
  const hiddenStorageKey = `live-hidden-tiles:${vmixHost}:${vmixPort}`;
  const armedStorageKey = `live-armed:${vmixHost}:${vmixPort}`;
  const transitionStorageKey = `live-transition:${vmixHost}:${vmixPort}`;
  const durationsStorageKey = `live-durations:${vmixHost}:${vmixPort}`;

  // Hydration: re-read localStorage whenever the target vMix changes.
  // Switching host → load that host's saved set (or reset to empty if
  // none). Reads live here (post-mount) rather than in a lazy `useState`
  // initializer so the client's first render matches the SSR output —
  // `localStorage` is undefined on the server. Writes go inline in the
  // toggle/select handlers below; this effect is read-only, which also
  // avoids a host-swap race between `OLD state → NEW key` and the
  // repopulation read.
  useEffect(() => {
    setHiddenTiles(readHiddenTilesFromStorage(hiddenStorageKey));
  }, [hiddenStorageKey]);

  useEffect(() => {
    setArmedTargetIds(readArmedTargetIdsFromStorage(armedStorageKey));
  }, [armedStorageKey]);

  useEffect(() => {
    setSelectedTransition(readSelectedTransitionFromStorage(transitionStorageKey));
  }, [transitionStorageKey]);

  useEffect(() => {
    setTransitionDurations(readTransitionDurationsFromStorage(durationsStorageKey));
  }, [durationsStorageKey]);

  const mixes: MixInfo[] = useMemo(() => {
    if (!vmixState) return [];
    return vmixState.inputs
      .filter((i) => i.type === "Mix")
      .map((i) => {
        const num = parseInt(i.shortTitle.replace(/\D/g, ""), 10);
        return { label: i.shortTitle, apiIndex: num - 1 };
      })
      .filter((m) => !isNaN(m.apiIndex) && m.apiIndex >= 1);
  }, [vmixState]);

  const transitions = useMemo(
    () => (vmixState ? buildTransitionOptions(vmixState.transitions) : []),
    [vmixState]
  );
  const defaultTransition: TransitionOption =
    transitions[0] ?? { label: "Cut", fn: "Cut", supportsMix: true };

  // Tabs shown in the TAP MODE bar
  const routeTargets: RouteTarget[] = useMemo(() => {
    const out: RouteTarget[] = [{ kind: "pgm" }, { kind: "pvw" }];
    for (const m of mixes) {
      out.push({ kind: "mix", index: m.apiIndex + 1 });
    }
    for (const opt of OUTPUT_OPTIONS) {
      out.push({
        kind: "out",
        outputFn: opt.value,
        xmlNumber: opt.xmlNumber,
      });
    }
    for (const n of OVERLAY_CHANNELS) {
      out.push({ kind: "ovl", layer: n });
    }
    return out;
  }, [mixes]);

  const availableBuses = useMemo(
    () => (vmixState?.audioBuses ?? []).map((b) => b.name),
    [vmixState]
  );

  const tally: TallyInfo | null = useMemo(() => {
    if (!vmixState) return null;
    return {
      activeInput: vmixState.activeInput,
      previewInput: vmixState.previewInput,
      overlays: vmixState.overlays,
      outputs: vmixState.outputs,
      mixes: vmixState.mixes,
    };
  }, [vmixState]);

  // No longer filters — hidden tiles render as collapsed vertical
  // strips (vMix-style mask) so the operator can still see them. The
  // filter would lose track of inputs when many are masked.
  const allInputs = useMemo(() => vmixState?.inputs ?? [], [vmixState]);

  // Per-input list of destination labels (OVL/MIX/OUT). Recomputed on
  // every poll tick but only mutates when a route actually changes —
  // InputCell's `sameLabels` equality bails on identical arrays.
  // PGM/PVW are intentionally excluded: their state is already drawn
  // by the tile's background colour + badge.
  const routedToByInput = useMemo(() => {
    const m = new Map<number, string[]>();
    if (!vmixState) return m;
    // Stage via Sets so duplicate output entries (vMix can emit
    // several <output number="N"> per type) don't produce duplicate
    // chips on the tile.
    const staging = new Map<number, Set<string>>();
    const add = (n: number, label: string) => {
      const set = staging.get(n);
      if (set) set.add(label);
      else staging.set(n, new Set([label]));
    };
    for (const ovl of vmixState.overlays) {
      if (ovl.inputNumber > 0) add(ovl.inputNumber, `OVL${ovl.number}`);
    }
    for (const mix of vmixState.mixes) {
      // Mix 1 is the main PGM bus — the PGM badge already covers it.
      if (mix.number > 1 && mix.active > 0) {
        add(mix.active, `MIX${mix.number}`);
      }
    }
    for (const out of vmixState.outputs) {
      if (out.inputNumber && out.inputNumber > 0) {
        add(out.inputNumber, `OUT${out.number}`);
      }
    }
    // Freeze into the ordered shape InputCell expects. Sort alpha so
    // OVL/MIX/OUT chips show in a stable order across ticks.
    for (const [n, set] of staging) {
      m.set(n, [...set].sort());
    }
    return m;
  }, [vmixState]);

  const selectedInput =
    vmixState?.inputs.find((i) => i.number === selectedDetails) ?? null;
  const pgmInput =
    vmixState?.inputs.find((i) => i.number === vmixState?.activeInput) ?? null;
  const pvwInput =
    vmixState?.inputs.find((i) => i.number === vmixState?.previewInput) ??
    null;

  // Refs read by the cell-click handler. We deliberately don't put
  // `armedTargetIds` / `routeTargets` directly in the useCallback dep
  // list — the handler is passed to every InputCell and its identity
  // is part of the memo equality. Re-creating it on every arm-toggle
  // would invalidate the memo on all ~30 tiles per click.
  const armedRef = useRef<Set<string>>(armedTargetIds);
  const routeTargetsRef = useRef<RouteTarget[]>(routeTargets);
  const transitionRef = useRef<TransitionButton>(selectedTransition);
  const durationsRef = useRef<Record<string, number>>(transitionDurations);
  useEffect(() => {
    armedRef.current = armedTargetIds;
  }, [armedTargetIds]);
  useEffect(() => {
    routeTargetsRef.current = routeTargets;
  }, [routeTargets]);
  useEffect(() => {
    transitionRef.current = selectedTransition;
  }, [selectedTransition]);
  useEffect(() => {
    durationsRef.current = transitionDurations;
  }, [transitionDurations]);

  // Broadcast an input to every armed destination in one go.
  //
  // Function families per the vMix HTTP API (vmixapi.com):
  //   • Cut / Fade / Merge → accept `Input=` and `Mix=`. Multiple
  //     mixes fire in parallel — these aren't animation-based so
  //     vMix processes them independently.
  //   • Stinger 1-8 → accept `Input=` and `Mix=` (vMix 28+) with
  //     comma-separated mix lists. CRITICAL: parallel single-mix
  //     calls collide on vMix's stinger pipeline (only one stinger
  //     animation at a time) — multi-mix routing only works when
  //     batched into a single `Mix=0,1,2` call.
  //   • Transition 1-4 (T-slots) → ignore both `Input=` and `Mix=`.
  //     Just *click* the GUI button on the main mix. We preview the
  //     input then fire the no-arg take. For non-main mixes the
  //     T-slot is unusable — fall back to Cut per mix.
  //   • OUT / OVL → independent, fired in parallel.
  const dispatchToArmed = useCallback(
    async (n: number) => {
      const armed = armedRef.current;
      if (armed.size === 0) return;
      const targets = routeTargetsRef.current.filter((tt) =>
        armed.has(routeTargetId(tt))
      );
      const t = transitionRef.current;
      // Honour the per-fn duration override before falling back to
      // the static config from baseTransitions. Stingers and Cut
      // ignore duration anyway, so this is a no-op for them.
      const effectiveDuration = durationsRef.current[t.fn] ?? t.duration;
      const isTSlot = /^Transition[1-4]$/.test(t.fn);
      const isStinger = /^Stinger[1-8]$/.test(t.fn);

      // Collect mix indices to transition (PGM = mix 0, MIX N = N-1).
      const mixIndices: number[] = [];
      const otherJobs: Array<() => Promise<void>> = [];
      for (const target of targets) {
        if (target.kind === "pgm") mixIndices.push(0);
        else if (target.kind === "mix") mixIndices.push(target.index - 1);
        else if (target.kind === "pvw")
          otherJobs.push(() => send(previewInput(n)));
        else if (target.kind === "out")
          otherJobs.push(() => send(setOutput(target.outputFn, String(n))));
        else if (target.kind === "ovl")
          otherJobs.push(() => send(overlayInput(target.layer, n)));
      }

      const jobs: Array<() => Promise<void>> = [...otherJobs];

      if (mixIndices.length > 0) {
        if (isStinger) {
          // Single batched call — comma-separated mixes per the docs.
          const mixCsv = mixIndices.join(",");
          jobs.push(() =>
            send({
              Function: t.fn,
              Input: String(n),
              Mix: mixCsv,
            })
          );
        } else if (isTSlot) {
          // T-slot: the GUI button click uses whatever's currently on
          // PVW, so we preview the requested input first then trigger
          // the take. Non-main mixes can't be reached this way (the
          // T-slot HTTP function takes no Mix arg) — fall back to Cut
          // there so the routing at least lands on the requested mix.
          //
          // Stinger T-slots are pre-translated to direct `Stinger{N}`
          // calls when userTransitions is built, so they never enter
          // this branch — they get the batched Stinger path above and
          // route to any mix cleanly.
          for (const mix of mixIndices) {
            if (mix === 0) {
              jobs.push(async () => {
                await send(previewInput(n));
                await send(pvwTransition(t.fn));
              });
            } else {
              jobs.push(() =>
                send(transitionInput("Cut", n, undefined, mix))
              );
            }
          }
        } else {
          // Cut / Fade / Merge / AlphaFade / Wipe / Zoom / etc. —
          // independent per-mix, fine in parallel.
          for (const mix of mixIndices) {
            jobs.push(() =>
              send(
                transitionInput(
                  t.fn,
                  n,
                  effectiveDuration,
                  mix === 0 ? undefined : mix
                )
              )
            );
          }
        }
      }

      await Promise.all(jobs.map((j) => j()));
    },
    [send]
  );

  // Stable callback refs so `InputCell` can bail on memo when the
  // tile's relevant fields are unchanged. Declared before the
  // disconnected early-return to satisfy the rules-of-hooks order.
  // Click semantics:
  //   • No destinations armed → toggle selection (open / close the
  //     details panel). Mirrors a plain inspector.
  //   • At least one destination armed → click ALWAYS broadcasts and
  //     keeps the tile selected. No toggle-off path, so re-clicking
  //     the same tile after arming PGM still routes it (the previous
  //     toggle behaviour ate the second click and required a third).
  const handleCellClick = useCallback(
    (n: number) => {
      const armed = armedRef.current;
      if (armed.size > 0) {
        setSelectedTile(n);
        setSelectedDetails(n);
        dispatchToArmed(n);
        return;
      }
      setSelectedTile((cur) => (cur === n ? null : n));
      setSelectedDetails((cur) => (cur === n ? null : n));
    },
    [dispatchToArmed]
  );

  // Toggle a destination in the armed set. Save inline (not via a
  // useEffect on armedTargetIds) so a host change can't snapshot the
  // previous host's set into the new host's key between effect ticks.
  const handleToggleTarget = useCallback(
    (t: RouteTarget) => {
      const id = routeTargetId(t);
      setArmedTargetIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        try {
          localStorage.setItem(armedStorageKey, JSON.stringify([...next]));
        } catch {
          /* quota / private mode */
        }
        return next;
      });
    },
    [armedStorageKey]
  );

  // Right-click toggle — mirrors vMix: hides on a visible tile,
  // unmasks on a collapsed strip. Selection is intentionally preserved
  // either way so the operator can keep routing a masked source.
  // Save inline (not via a useEffect on `hiddenTiles`) so a host
  // change can't snapshot the previous host's set into the new
  // host's storage slot between effect ticks.
  const handleToggleHide = useCallback(
    (n: number) => {
      setHiddenTiles((prev) => {
        const next = new Set(prev);
        if (next.has(n)) next.delete(n);
        else next.add(n);
        try {
          localStorage.setItem(
            hiddenStorageKey,
            JSON.stringify([...next])
          );
        } catch {
          /* quota / private mode — lose persistence this tick */
        }
        return next;
      });
    },
    [hiddenStorageKey]
  );

  if (!connected || !vmixState) {
    // Use the canonical TopBar so the offline state of Live matches
    // every other page's identity strip (num / label / status pill)
    // — it previously rendered a bare centered paragraph, breaking the
    // app-wide convention.
    return (
      <div className="flex flex-col">
        <TopBar
          status="offline"
          num="02"
          label="Switcher"
          title="Live"
          sub="no vmix"
        />
        <Section>
          <div className="text-[13px] text-sw-muted py-12 text-center">
            {!connected ? "Connect to vMix to use live switcher." : "Loading…"}
          </div>
        </Section>
      </div>
    );
  }

  // Curated transition set — the common ones that operators reach
  // for in live ops. All accept `Input=` and `Mix=` directly, so
  // they fan out across mixes cleanly with no T-slot proxy needed.
  const baseTransitions: TransitionButton[] = [
    { label: "Cut",        fn: "Cut" },
    { label: "Fade",       fn: "Fade",       duration: 500, hint: "500" },
    // AlphaFade (vMix 29+) — separate entry alongside Fade so the
    // operator can pick the right one per scene. Same Input/Mix
    // surface as Fade plus correct alpha-to-alpha blending on NDI /
    // PNG / title sources.
    { label: "α Fade",     fn: "AlphaFade",  duration: 500, hint: "500" },
    { label: "Wipe",       fn: "Wipe",       duration: 500, hint: "500" },
    { label: "Slide",      fn: "Slide",      duration: 500, hint: "500" },
    { label: "Fly",        fn: "Fly",        duration: 500, hint: "500" },
    { label: "Zoom",       fn: "Zoom",       duration: 500, hint: "500" },
    { label: "Merge",      fn: "Merge",      duration: 500, hint: "500" },
  ];

  // Direct stinger calls. `Stinger{N}` accepts Input + Mix (vMix 28+)
  // so we can broadcast a specific input via a specific stinger to
  // any mix in a single atomic HTTP request.
  const stingerTransitions: TransitionButton[] = STINGER_CHANNELS.map(
    (n) => ({ label: `S${n}`, fn: `Stinger${n}` })
  );

  const handleSelectTransition = (t: TransitionButton) => {
    setSelectedTransition(t);
    try {
      localStorage.setItem(transitionStorageKey, JSON.stringify(t));
    } catch {
      /* quota / private mode */
    }
  };

  const handleSetDuration = (fn: string, ms: number) => {
    setTransitionDurations((prev) => {
      const next = { ...prev, [fn]: ms };
      try {
        localStorage.setItem(durationsStorageKey, JSON.stringify(next));
      } catch {
        /* quota / private mode */
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <LiveHeader
        pgmInput={pgmInput}
        pvwInput={pvwInput}
        // Single combined row — base + stinger flow together so wrap
        // happens only when the viewport actually can't fit them all,
        // not just because a sub-group label took 80 px.
        baseTransitions={[...baseTransitions, ...stingerTransitions]}
        selectedTransitionFn={selectedTransition.fn}
        onSelectTransition={handleSelectTransition}
        durations={transitionDurations}
        onSetDuration={handleSetDuration}
      />

      <RouteModeBar
        targets={routeTargets}
        armedIds={armedTargetIds}
        onToggle={handleToggleTarget}
        onConfigureOutput={(outputFn, source) =>
          send(setOutputSource(outputFn, source))
        }
      />

      <main className="flex-1 overflow-y-auto" style={{ padding: 12 }}>
        {/* Flex-wrap instead of CSS grid: lets full tiles flow at
            ~140 px while masked tiles only occupy 30 px, so they line
            up inline with no empty grid cells. */}
        <div
          className="flex flex-wrap content-start"
          style={{ gap: 6 }}
        >
          {allInputs.map((input) => {
            const state =
              input.number === tally?.activeInput
                ? "pgm"
                : input.number === tally?.previewInput
                  ? "pvw"
                  : "default";
            const routedTo = routedToByInput.get(input.number);
            if (hiddenTiles.has(input.number)) {
              return (
                <CollapsedInputCell
                  key={input.key}
                  input={input}
                  state={state}
                  selected={selectedTile === input.number}
                  onClick={handleCellClick}
                  onToggleHide={handleToggleHide}
                  routedTo={routedTo}
                />
              );
            }
            return (
              <div
                key={input.key}
                style={{ flex: "1 1 140px", minWidth: 140, maxWidth: 240 }}
              >
                <InputCell
                  input={input}
                  state={state}
                  selected={selectedTile === input.number}
                  onClick={handleCellClick}
                  onToggleHide={handleToggleHide}
                  routedTo={routedTo}
                />
              </div>
            );
          })}
        </div>

        {allInputs.length === 0 && (
          <div className="py-16 text-center text-[12px] text-sw-muted">
            No inputs.
          </div>
        )}
      </main>

      {selectedInput && tally && (
        <DetailsPanel
          input={selectedInput}
          pgmTransition={defaultTransition}
          mixTransition={defaultTransition}
          send={send}
          availableBuses={availableBuses}
          tally={tally}
          mixes={mixes}
        />
      )}
    </div>
  );
}
