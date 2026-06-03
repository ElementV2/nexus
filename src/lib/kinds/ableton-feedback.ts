import { registerFeedback, type FeedbackOverride } from "@/lib/core/feedback";

/**
 * Ableton Live Stream Deck feedback rules. Pure (no broker imports).
 * Registered for kind "ableton" at import.
 */
function abletonFeedback(
  action: string,
  opts: Record<string, unknown>,
  vars: Record<string, unknown>
): FeedbackOverride | null {
  // A clip-launch button lights green while ITS clip is the one playing on
  // that track — Ableton pushes the track's playing scene index live, mirrored
  // into `track_<track>_playing` by the variable bridge.
  if (action === "fire-clip") {
    const track = Number(opts.track);
    const scene = Number(opts.scene);
    if (!Number.isFinite(track) || !Number.isFinite(scene)) return null;
    const playing = vars[`track_${track}_playing`];
    if (typeof playing === "number" && playing === scene) {
      return { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
    }
    return null;
  }
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
