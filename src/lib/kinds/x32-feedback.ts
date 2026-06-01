import {
  registerFeedback,
  disconnectedOverride,
  type FeedbackOverride,
} from "@/lib/core/feedback";

/**
 * X32 / M32 Stream Deck feedback rules. Pure (no broker imports).
 * Registered for kind "x32" at import.
 *
 * X32's "on" semantics are inverted (1 = audible, 0 = muted), so the bridge
 * publishes `<thing>_on` booleans and we fire red on `false`. Mute groups
 * are the opposite — `true` means the group is actively muting.
 */
function x32Feedback(
  action: string,
  opts: Record<string, unknown>,
  vars: Record<string, unknown>
): FeedbackOverride | null {
  const dim = disconnectedOverride(vars);
  if (dim) return dim;

  const RED: FeedbackOverride = { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
  const mutedRed = (on: unknown): FeedbackOverride | null =>
    on === false ? RED : null;

  if (action === "ch-mute" || action === "ch-mute-toggle") {
    const n = num(opts.channel);
    return n === undefined ? null : mutedRed(vars[`ch_${n}_on`]);
  }
  if (action === "bus-mute" || action === "bus-mute-toggle") {
    const n = num(opts.bus);
    return n === undefined ? null : mutedRed(vars[`bus_${n}_on`]);
  }
  if (action === "main-mute" || action === "main-mute-toggle") {
    return mutedRed(vars.main_on);
  }
  const dca = /^dca-(\d+)-mute(?:-toggle)?$/.exec(action);
  if (dca) {
    return mutedRed(vars[`dca_${Number(dca[1])}_on`]);
  }
  if (action === "mute-group-set") {
    const n = num(opts.group);
    // Group active (true) = it's muting → light it red.
    return n !== undefined && vars[`mutegroup_${n}`] === true ? RED : null;
  }
  return null;
}

registerFeedback("x32", x32Feedback);
