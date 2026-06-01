import { registerFeedback, type FeedbackOverride } from "@/lib/core/feedback";

/**
 * OBS Stream Deck feedback rules. Pure (no broker imports). Registered for
 * kind "obs" at import.
 */
function obsFeedback(
  action: string,
  opts: Record<string, unknown>,
  vars: Record<string, unknown>
): FeedbackOverride | null {
  const sceneName = typeof opts.sceneName === "string" ? opts.sceneName : undefined;

  if (action === "set-program-scene") {
    if (sceneName && vars.current_program_scene === sceneName) {
      return { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
    }
    return null;
  }
  if (action === "set-preview-scene") {
    // Live priority: a scene that's on PROGRAM stays red even on a
    // preview button (program wins over preview).
    if (sceneName && vars.current_program_scene === sceneName) {
      return { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
    }
    if (sceneName && vars.current_preview_scene === sceneName) {
      return { bgcolor: "#34c759", fgcolor: "#000000" };
    }
    return null;
  }
  if (
    action === "toggle-stream" ||
    action === "start-stream" ||
    action === "stop-stream"
  ) {
    if (vars.streaming === true) {
      return { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
    }
    return null;
  }
  if (
    action === "toggle-record" ||
    action === "start-record" ||
    action === "stop-record"
  ) {
    if (vars.recording === true) {
      return { bgcolor: "#8e44ad", fgcolor: "#ffffff" };
    }
    return null;
  }
  if (action === "set-studio-mode") {
    if (vars.studio_mode === true) {
      return { badge: { color: "#34c759" } };
    }
    return null;
  }
  return null;
}

registerFeedback("obs", obsFeedback);
