import { registerFeedback, type FeedbackOverride } from "@/lib/core/feedback";

/**
 * Ableton Live Stream Deck feedback rules. Pure (no broker imports).
 * Registered for kind "ableton" at import.
 */
function abletonFeedback(
  action: string,
  _opts: Record<string, unknown>,
  vars: Record<string, unknown>
): FeedbackOverride | null {
  if (action === "play" || action === "stop" || action === "continue") {
    if (vars.is_playing === true) {
      return { bgcolor: "#34c759", fgcolor: "#000000" };
    }
    return null;
  }
  if (action === "set-metronome") {
    if (vars.metronome === true) {
      return { badge: { color: "#af52de" } };
    }
    return null;
  }
  return null;
}

registerFeedback("ableton", abletonFeedback);
