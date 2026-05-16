import { cn } from "@/lib/utils";

/**
 * Tactical Refined page header. Compact (~56 px), dense, mono labels.
 * Replaces the previous 90 px "Swiss display" header. Layout:
 *
 *   [● LIVE]  STATUS  ·  NN / SECTION
 *   13 channels · 5 buses                              ‖ <toolbar>
 *
 * The right slot holds contextual ToolbarSlot groups — they sit in a
 * collés strip separated by 1 px line borders.
 */
export function TopBar({
  status = "live",
  num,
  label,
  title,
  sub,
  right,
}: {
  status?: "live" | "offline" | "booting";
  num?: string;
  label?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  // Live = the boring default — no state label, the rest of the UI
  // already tells you everything works. When the connection is NOT
  // healthy we surface that with an amber tag (offline / booting) so
  // the user notices without a red dot dominating every page header.
  const showStatusTag = status !== "live";
  const statusLabel = status === "booting" ? "Booting" : "Offline";

  return (
    <header
      className={cn("flex items-stretch")}
      style={{
        minHeight: 56,
        background: "var(--panel)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Identity block */}
      <div
        className="flex flex-col justify-center min-w-0"
        style={{
          padding: "8px 16px",
          background: "var(--panel-2)",
          borderRight: "1px solid var(--line)",
          minWidth: 220,
        }}
      >
        <div
          className="flex items-center"
          style={{ gap: 8, marginBottom: 3 }}
          role={showStatusTag ? "status" : undefined}
          aria-live={showStatusTag ? "polite" : undefined}
        >
          {num && label && (
            <span className="label">
              {num} / {label}
            </span>
          )}
          {showStatusTag && (
            <>
              {num && label && (
                <span
                  style={{ color: "var(--sub)", fontSize: 10 }}
                  aria-hidden
                >
                  ·
                </span>
              )}
              <span
                className="font-mono uppercase"
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "1.6px",
                  color: "var(--amber)",
                  padding: "2px 6px",
                  background: "var(--amber-tint)",
                  border: "1px solid var(--amber)",
                }}
              >
                {statusLabel}
              </span>
            </>
          )}
        </div>
        <div
          className="flex items-baseline min-w-0"
          style={{ gap: 8 }}
        >
          {/* The page-level heading. h1 sits inside the visual style
              wrapper so screen-reader heading-jump nav finds it on
              every page; the default user-agent <h1> margins are
              overridden below to keep the bar's tight typography. */}
          <h1
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
              margin: 0,
              padding: 0,
              lineHeight: 1.2,
            }}
            className="truncate"
          >
            {title}
          </h1>
          {sub && (
            <span
              className="font-mono truncate"
              style={{ fontSize: 11, color: "var(--muted)" }}
            >
              {sub}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1" />

      {right && <div className="flex items-stretch">{right}</div>}
    </header>
  );
}
