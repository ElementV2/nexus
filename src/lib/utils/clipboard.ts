/**
 * Copy a string to the system clipboard, with a fallback for hosts
 * served over plain HTTP (LAN deployments). `navigator.clipboard` is
 * gated to secure contexts (HTTPS or localhost) — outside of those
 * it's `undefined` and accessing `.writeText` crashes. The legacy
 * `document.execCommand("copy")` route still works in every browser
 * we target and doesn't need a secure context.
 *
 * Resolves `true` on success, `false` if both paths failed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern path. Wrapped in try so a denied permission doesn't bubble.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand path
    }
  }

  // Fallback: stage the text in an off-screen textarea, select it,
  // and ask the document to copy the selection. Off-screen rather
  // than display:none so the selection still applies.
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.padding = "0";
  ta.style.border = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  const prevSelection = document.getSelection()?.rangeCount
    ? document.getSelection()?.getRangeAt(0)
    : null;
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    return ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    if (prevSelection) {
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(prevSelection);
    }
  }
}
