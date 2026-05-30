"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createContext } from "react";
import { Eyebrow } from "./Eyebrow";

/**
 * In-app confirmation modal — replaces the browser's native
 * `window.confirm` so destructive actions look like the rest of the
 * app. Two pieces:
 *
 *   • `<ConfirmProvider>` mounted once near the app root holds the
 *     dialog state and renders an overlay portal at the bottom of
 *     the tree.
 *   • `useConfirm()` returns an async function the caller invokes
 *     with `{ title, message, ... }` and awaits a boolean.
 *
 * The dialog autofocuses the confirm button (or the cancel button
 * when `dangerous` is true), and Escape always cancels — matches the
 * affordances operators expect from native dialogs without the OS
 * chrome.
 */

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Marks the action as destructive. Adds a red border, swaps the
   * confirm button to the danger color, and autofocuses the cancel
   * button so a stray Enter doesn't delete by accident.
   */
  dangerous?: boolean;
  /**
   * Single-button info / acknowledgement dialog — replaces
   * `window.alert`. Cancel button is hidden; Enter and Esc both
   * close (always resolves `true`).
   */
  infoOnly?: boolean;
}

type Resolver = (confirmed: boolean) => void;

interface ConfirmCtx {
  show: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmCtx | null>(null);

interface Pending extends ConfirmOptions {
  resolver: Resolver;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const show = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolver: resolve });
      }),
    []
  );

  const close = useCallback(
    (confirmed: boolean) => {
      setPending((cur) => {
        if (cur) cur.resolver(confirmed);
        return null;
      });
    },
    []
  );

  // Esc cancels. Trap focus inside the dialog when open so Tab
  // doesn't escape to the page behind. Only listen while a dialog
  // exists to avoid global keyhandler weight when idle.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Info dialogs treat Esc as acknowledgement, not cancel —
        // there's nothing TO cancel.
        close(pending.infoOnly ? true : false);
      } else if (e.key === "Enter") {
        // Enter confirms unless the cancel button is focused (which
        // happens automatically when `dangerous` is true).
        if (
          document.activeElement instanceof HTMLButtonElement &&
          document.activeElement.dataset.role === "cancel"
        ) {
          e.preventDefault();
          close(false);
          return;
        }
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={{ show }}>
      {children}
      {pending && (
        <ConfirmOverlay
          opts={pending}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fall back to native confirm if a caller forgets the provider —
    // better than a runtime crash that loses the user's action.
    return (opts: ConfirmOptions) =>
      Promise.resolve(
        window.confirm(`${opts.title}${opts.message ? `\n\n${opts.message}` : ""}`)
      );
  }
  return ctx.show;
}

// ─────────────────────────── Overlay ──────────────────────────────────

function ConfirmOverlay({
  opts,
  onConfirm,
  onCancel,
}: {
  opts: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Autofocus: cancel button for destructive ops (defensive default),
  // confirm button otherwise (lets the operator Enter through a
  // benign prompt without hunting the mouse).
  useEffect(() => {
    if (opts.dangerous) cancelRef.current?.focus();
    else confirmRef.current?.focus();
  }, [opts.dangerous]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={opts.title}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        // Stop propagation so clicking inside the dialog doesn't
        // hit the overlay's cancel handler.
        onClick={(e) => e.stopPropagation()}
        style={{
          minWidth: 320,
          maxWidth: 480,
          background: "var(--panel)",
          border: `2px solid ${opts.dangerous ? "var(--pgm)" : "var(--line-hi)"}`,
          color: "var(--ink)",
          padding: 0,
          boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header — uppercase title strip, matches TopBar typography. */}
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Eyebrow tone={opts.dangerous ? "amber" : "muted"}>
            {opts.dangerous ? "Confirm destructive action" : "Confirm"}
          </Eyebrow>
          <span
            className="font-mono"
            style={{
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--ink)",
            }}
          >
            {opts.title}
          </span>
        </div>

        {/* Body */}
        {opts.message && (
          <div
            style={{
              padding: "14px 18px",
              fontSize: 13,
              lineHeight: 1.4,
              color: "var(--mid)",
            }}
          >
            {opts.message}
          </div>
        )}

        {/* Footer — cancel left, confirm right. Mirrors the rest of
            the app where the primary action sits at the bottom-right
            of cards. */}
        <div
          style={{
            padding: "12px 14px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            background: "var(--card)",
            borderTop: "1px solid var(--line)",
          }}
        >
          {!opts.infoOnly && (
            <button
              ref={cancelRef}
              data-role="cancel"
              onClick={onCancel}
              className="font-mono uppercase transition-colors"
              style={{
                padding: "6px 14px",
                fontSize: 11,
                letterSpacing: "1.4px",
                fontWeight: 600,
                background: "var(--panel-2)",
                color: "var(--mid)",
                border: "1px solid var(--line-hi)",
                cursor: "pointer",
              }}
            >
              {opts.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            ref={confirmRef}
            data-role="confirm"
            onClick={onConfirm}
            className="font-mono uppercase transition-colors"
            style={{
              padding: "6px 14px",
              fontSize: 11,
              letterSpacing: "1.4px",
              fontWeight: 700,
              background: opts.dangerous ? "var(--pgm)" : "var(--ink)",
              color: opts.dangerous ? "#ffffff" : "var(--bg)",
              border: `1px solid ${opts.dangerous ? "var(--pgm)" : "var(--ink)"}`,
              cursor: "pointer",
            }}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
