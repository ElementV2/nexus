import { cn } from "@/lib/utils";
import { Eyebrow } from "./Eyebrow";

/**
 * Toolbar slot — sits in the right of TopBar. Each slot has a small
 * mono label header and a row of controls below. Slots are separated
 * by 1 px line borders (collés bar).
 */
export function ToolbarSlot({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col justify-center", className)}
      style={{
        padding: "8px 16px",
        gap: 4,
        borderLeft: "1px solid var(--line)",
      }}
    >
      {label && <Eyebrow tone="muted">{label}</Eyebrow>}
      <div className="flex items-center" style={{ minHeight: 22 }}>
        {children}
      </div>
    </div>
  );
}
