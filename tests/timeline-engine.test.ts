import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The Live Show playback engine. Verifies the poll-and-compare clock:
 * clips fire when the head crosses their offset, parallel tracks fire
 * together, WAIT markers clamp the head until GO (and `skipWaits` flies
 * through), a backward seek re-arms clips, and the head stops at the end.
 *
 * `runSteps` (the device dispatch) and `getScenario` (the store) are mocked
 * so the test is pure timing logic — no brokers, no files.
 */

// vi.mock factories are hoisted above imports, so the mock fns must be
// created via vi.hoisted (which runs first) rather than plain top-level
// consts (which would be in the temporal dead zone inside the factory).
const { runSteps, getScenario } = vi.hoisted(() => ({
  runSteps: vi.fn(async () => ({ results: [{ ok: true }] })),
  getScenario: vi.fn(),
}));

vi.mock("@/lib/core/catalog", () => ({ runSteps }));
vi.mock("@/lib/db/timeline", () => ({ getScenario }));

import { timelineEngine } from "@/lib/timeline/engine";
import type { Scenario } from "@/lib/db/timeline";

type Clip = { id: string; offsetMs: number; actionId: string };

function scenario(opts: {
  durationMs?: number;
  tracks?: Clip[][];
  waits?: number[];
}): Scenario {
  return {
    id: "s",
    label: "s",
    durationMs: opts.durationMs ?? 5000,
    tracks: (opts.tracks ?? []).map((clips, i) => ({
      id: `t${i}`,
      label: `t${i}`,
      clips: clips.map((c) => ({
        id: c.id,
        offsetMs: c.offsetMs,
        steps: [{ actionId: c.actionId }],
      })),
    })),
    waits: (opts.waits ?? []).map((offsetMs, i) => ({ id: `w${i}`, offsetMs })),
  };
}

/** actionIds that have fired so far, in call order. */
function firedActionIds(): string[] {
  return runSteps.mock.calls.map(
    // @ts-expect-error mock arg shape
    (call) => call[0][0].actionId as string
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  runSteps.mockClear();
  getScenario.mockReset();
});

afterEach(() => {
  timelineEngine.stop();
  vi.useRealTimers();
});

describe("timeline engine", () => {
  it("fires clips as the head crosses their offsets", async () => {
    getScenario.mockReturnValue(
      scenario({
        tracks: [
          [
            { id: "c0", offsetMs: 0, actionId: "k:a0" },
            { id: "c1", offsetMs: 1000, actionId: "k:a1" },
            { id: "c2", offsetMs: 2000, actionId: "k:a2" },
          ],
        ],
      })
    );
    timelineEngine.play("s");
    await vi.advanceTimersByTimeAsync(1100);

    const fired = firedActionIds();
    expect(fired).toContain("k:a0");
    expect(fired).toContain("k:a1");
    expect(fired).not.toContain("k:a2");
  });

  it("fires clips at the same offset on different tracks together", async () => {
    getScenario.mockReturnValue(
      scenario({
        tracks: [
          [{ id: "a", offsetMs: 500, actionId: "k:left" }],
          [{ id: "b", offsetMs: 500, actionId: "k:right" }],
        ],
      })
    );
    timelineEngine.play("s");
    await vi.advanceTimersByTimeAsync(600);

    const fired = firedActionIds();
    expect(fired).toContain("k:left");
    expect(fired).toContain("k:right");
  });

  it("parks at a WAIT until GO is pressed", async () => {
    getScenario.mockReturnValue(
      scenario({
        tracks: [[{ id: "c", offsetMs: 2000, actionId: "k:after" }]],
        waits: [1000],
      })
    );
    timelineEngine.play("s");
    await vi.advanceTimersByTimeAsync(1300);

    let st = timelineEngine.getState();
    expect(st.state).toBe("waiting");
    expect(st.playheadMs).toBe(1000);
    expect(firedActionIds()).not.toContain("k:after");

    timelineEngine.go();
    await vi.advanceTimersByTimeAsync(1300);

    st = timelineEngine.getState();
    expect(st.state).not.toBe("waiting");
    expect(firedActionIds()).toContain("k:after");
  });

  it("skipWaits plays straight through WAIT markers", async () => {
    getScenario.mockReturnValue(
      scenario({
        tracks: [[{ id: "c", offsetMs: 2000, actionId: "k:after" }]],
        waits: [1000],
      })
    );
    timelineEngine.play("s", { skipWaits: true });
    await vi.advanceTimersByTimeAsync(2300);

    expect(timelineEngine.getState().state).not.toBe("waiting");
    expect(firedActionIds()).toContain("k:after");
  });

  it("re-arms clips after a backward seek", async () => {
    getScenario.mockReturnValue(
      scenario({
        tracks: [[{ id: "c", offsetMs: 500, actionId: "k:beep" }]],
      })
    );
    timelineEngine.play("s");
    await vi.advanceTimersByTimeAsync(600);
    expect(firedActionIds().filter((a) => a === "k:beep")).toHaveLength(1);

    timelineEngine.seek(0);
    timelineEngine.resume();
    await vi.advanceTimersByTimeAsync(600);
    expect(firedActionIds().filter((a) => a === "k:beep")).toHaveLength(2);
  });

  it("stops at the end of the timeline", async () => {
    getScenario.mockReturnValue(
      scenario({
        durationMs: 1000,
        tracks: [[{ id: "c", offsetMs: 0, actionId: "k:a" }]],
      })
    );
    timelineEngine.play("s");
    await vi.advanceTimersByTimeAsync(1200);

    const st = timelineEngine.getState();
    expect(st.state).toBe("idle");
    expect(st.playheadMs).toBe(1000);
  });
});
