"use client";

import { useEffect } from "react";

/**
 * Global UI guard. Two responsibilities:
 *
 * 1. **Drag selection guard** — while the user is dragging an
 *    interactive surface (slider, color wheel, progress seek,
 *    anything with `.touch-none` or `[data-slot="slider"]`), add
 *    `is-dragging` to <html> so CSS in globals.css can lock the
 *    cursor and kill any residual selection.
 *
 * 2. **Context-menu suppressor** — broadcast operators don't want
 *    the browser's native right-click menu interrupting a switch.
 *    `<input>` / `<textarea>` / contenteditable surfaces still get
 *    their menu (paste, spellcheck) so text editing isn't broken.
 */
export function DragSelectionGuard() {
  useEffect(() => {
    const doc = document.documentElement;

    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.touch-none, [data-slot="slider"]')) {
        doc.classList.add("is-dragging");
      }
    };

    const onUp = () => {
      doc.classList.remove("is-dragging");
    };

    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // Allow the native menu only inside text-entry surfaces so paste
      // / spellcheck still work where it actually matters.
      if (target?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) {
        return;
      }
      e.preventDefault();
    };

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("contextmenu", onContextMenu);

    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.removeEventListener("contextmenu", onContextMenu);
      doc.classList.remove("is-dragging");
    };
  }, []);

  return null;
}
