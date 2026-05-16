import { useEffect } from "react";
import { useOverlayEditorStore, getActiveOverlay } from "@/stores/overlay-editor-store";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const store = useOverlayEditorStore.getState();
      const tag = (e.target as HTMLElement)?.tagName;

      // Don't handle shortcuts when typing in inputs
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const hasSelection = store.selectedElementIds.length > 0;

      switch (e.key) {
        case "Delete":
        case "Backspace":
          if (hasSelection) {
            e.preventDefault();
            store.removeElements(store.selectedElementIds);
          }
          break;

        case "c":
          if (ctrl && hasSelection) {
            e.preventDefault();
            store.copy();
          }
          break;

        case "x":
          if (ctrl && hasSelection) {
            e.preventDefault();
            store.cut();
          }
          break;

        case "v":
          // Two intents share this key: Ctrl+V = paste, plain v = pick
          // the select tool. JS `switch` only matches the first arm, so
          // they MUST live in the same case — the duplicate `case "v":`
          // further down for the tool shortcut was dead code.
          if (ctrl) {
            e.preventDefault();
            store.paste();
          } else {
            store.setActiveTool("select");
          }
          break;

        case "z":
          if (ctrl && !shift) {
            e.preventDefault();
            store.undo();
          }
          break;

        case "y":
          if (ctrl) {
            e.preventDefault();
            store.redo();
          }
          break;

        case "Z":
          if (ctrl && shift) {
            e.preventDefault();
            store.redo();
          }
          break;

        case "a":
          if (ctrl) {
            e.preventDefault();
            store.selectAll();
          }
          break;

        case "d":
          if (ctrl && hasSelection) {
            e.preventDefault();
            store.duplicateElements(store.selectedElementIds);
          }
          break;

        case "Escape":
          store.deselectAll();
          store.setActiveTool("select");
          break;

        case "ArrowUp":
          if (hasSelection) {
            e.preventDefault();
            const delta = shift ? -10 : -1;
            store.pushUndo();
            store.updateElements(
              store.selectedElementIds.map((id) => ({
                id,
                changes: {
                  y:
                    (getActiveOverlay()?.elements.find((el) => el.id === id)?.y ?? 0) +
                    delta,
                },
              }))
            );
          }
          break;

        case "ArrowDown":
          if (hasSelection) {
            e.preventDefault();
            const delta = shift ? 10 : 1;
            store.pushUndo();
            store.updateElements(
              store.selectedElementIds.map((id) => ({
                id,
                changes: {
                  y:
                    (getActiveOverlay()?.elements.find((el) => el.id === id)?.y ?? 0) +
                    delta,
                },
              }))
            );
          }
          break;

        case "ArrowLeft":
          if (hasSelection) {
            e.preventDefault();
            const delta = shift ? -10 : -1;
            store.pushUndo();
            store.updateElements(
              store.selectedElementIds.map((id) => ({
                id,
                changes: {
                  x:
                    (getActiveOverlay()?.elements.find((el) => el.id === id)?.x ?? 0) +
                    delta,
                },
              }))
            );
          }
          break;

        case "ArrowRight":
          if (hasSelection) {
            e.preventDefault();
            const delta = shift ? 10 : 1;
            store.pushUndo();
            store.updateElements(
              store.selectedElementIds.map((id) => ({
                id,
                changes: {
                  x:
                    (getActiveOverlay()?.elements.find((el) => el.id === id)?.x ?? 0) +
                    delta,
                },
              }))
            );
          }
          break;

        case "]":
          if (hasSelection) {
            e.preventDefault();
            store.bringForward(store.selectedElementIds);
          }
          break;

        case "[":
          if (hasSelection) {
            e.preventDefault();
            store.sendBackward(store.selectedElementIds);
          }
          break;

        // Tool shortcuts (plain `v` is merged into the Ctrl+V arm
        // above to avoid the duplicate-case dead-code trap).
        case "h":
          if (!ctrl) store.setActiveTool("hole");
          break;

        case "t":
          if (!ctrl) store.setActiveTool("text");
          break;

        case "i":
          if (!ctrl) store.setActiveTool("image");
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
