"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useOverlayEditorStore } from "@/stores/overlay-editor-store";
import type { TextElement } from "@/lib/web-assets/types";

interface TextElementViewProps {
  element: TextElement;
  selected: boolean;
}

export function TextElementView({ element, selected }: TextElementViewProps) {
  const updateElement = useOverlayEditorStore((s) => s.updateElement);
  const pushUndo = useOverlayEditorStore((s) => s.pushUndo);
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  const textShadow =
    element.shadowBlur > 0 || element.shadowOffsetX !== 0 || element.shadowOffsetY !== 0
      ? `${element.shadowOffsetX}px ${element.shadowOffsetY}px ${element.shadowBlur}px ${element.shadowColor}`
      : undefined;

  const webkitTextStroke =
    element.strokeWidth > 0
      ? `${element.strokeWidth}px ${element.strokeColor}`
      : undefined;

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (element.locked) return;
      e.stopPropagation();
      e.preventDefault();
      setEditing(true);
    },
    [element.locked]
  );

  // Derive effective editing state (auto-cancel when deselected)
  const isEditing = editing && selected;

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(editRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isEditing]);

  const commitEdit = useCallback(() => {
    if (!editRef.current) return;
    const newContent = editRef.current.innerText;
    if (newContent !== element.content) {
      pushUndo();
      updateElement(element.id, { content: newContent });
    }
    setEditing(false);
  }, [element.id, element.content, updateElement, pushUndo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditing(false);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitEdit();
      }
      // Stop propagation so keyboard shortcuts don't fire while editing
      e.stopPropagation();
    },
    [commitEdit]
  );

  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    fontFamily: element.fontFamily,
    fontSize: element.fontSize,
    fontWeight: element.fontWeight,
    color: element.color,
    backgroundColor: element.backgroundColor,
    textAlign: element.textAlign,
    lineHeight: element.lineHeight,
    textShadow,
    WebkitTextStroke: webkitTextStroke,
    display: "flex",
    alignItems: "center",
    justifyContent:
      element.textAlign === "center"
        ? "center"
        : element.textAlign === "right"
        ? "flex-end"
        : "flex-start",
    overflow: "hidden",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  };

  if (isEditing) {
    return (
      <div
        ref={editRef}
        contentEditable
        suppressContentEditableWarning
        style={{
          ...style,
          cursor: "text",
          outline: "none",
        }}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {element.content}
      </div>
    );
  }

  return (
    <div style={style} onDoubleClick={handleDoubleClick}>
      {element.content}
    </div>
  );
}
