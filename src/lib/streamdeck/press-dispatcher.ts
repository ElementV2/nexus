import { streamdeckDriver } from "./driver";
import { getStreamdeckStore } from "@/lib/db/streamdeck";
import { runSteps } from "@/lib/core/catalog";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";

/**
 * Single server-side subscriber that turns physical Stream Deck key
 * presses into preset executions. Lives apart from the SSE event
 * route because that route subscribes ONCE PER CLIENT — folding the
 * dispatch into it caused every key press to fire `runSteps` N
 * times when N tabs were open.
 *
 * Boot from `boot.ts`. The driver's own coalescing/queueing
 * (per-key debounced renders) is unrelated to this — presses don't
 * need debouncing because the hardware emits exactly one `down`
 * per physical press.
 */


class PressDispatcherImpl {
  private unsubscribe: (() => void) | null = null;
  private booted = false;

  start(): void {
    if (this.booted) return;
    this.booted = true;
    this.unsubscribe = streamdeckDriver.subscribe((event) => {
      if (event.type !== "key-down") return;
      if (!event.serialNumber || event.keyIndex === undefined) return;
      // Look up the bound preset via the device's HID serial number
      // (NOT path — layouts persist by serial so they survive USB
      // re-plug). Same lookup as the SSE forwarder used to do, but
      // here it runs at most once per press regardless of how many
      // SSE consumers are connected.
      const store = getStreamdeckStore();
      const serial = event.serialNumber;
      const layout = store.layouts.find((l) =>
        l.deviceSerials.includes(serial)
      );
      const binding = layout?.bindings[event.keyIndex];
      if (!binding) return;
      // Pass the binding's connection pin so the press fires against
      // the operator-chosen instance (e.g. vMix #2). Each step may
      // still override with its own connectionId inside runSteps.
      // allowDefault=false: a deck press fires ONLY against the connection
      // it's pinned to (step pin → binding pin → first of kind). It must
      // never follow the per-kind "default" — that's display-only, and a
      // deck must not silently re-target when the operator changes it.
      void runSteps(
        binding.preset.steps,
        binding.preset.kind,
        binding.connectionId,
        false
      ).catch(() => {
        /* runSteps already shapes its own error per step; nothing
           to do at the dispatcher level — driver / SSE error
           channel will surface broken commands. */
      });
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.booted = false;
  }
}

export const pressDispatcher = hmrSingleton(
  "streamdeck-press-dispatcher",
  PressDispatcherImpl
);
