import { cn } from "@/lib/utils";
import { Eyebrow } from "./Eyebrow";

/**
 * Stat block — used inside dashboards and side-panels.
 *  - mono uppercase label
 *  - mono numeral (display-m, 22 px)
 *  - sub line in muted text
 */
export function Stat({
  label,
  value,
  sub,
  tone = "muted",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "muted" | "red" | "green" | "amber" | "blue" | "purple";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)} style={{ gap: 6 }}>
      <Eyebrow tone={tone}>{label}</Eyebrow>
      <div
        className="font-mono"
        style={{
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: "var(--ink)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</div>
      )}
    </div>
  );
}
