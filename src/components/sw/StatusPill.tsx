import { cn } from "@/lib/utils";

type Role = "red" | "green" | "amber" | "blue" | "purple" | "muted";

export function StatusPill({
  children,
  role = "muted",
  variant = "outline",
  glyph,
  className,
}: {
  children: React.ReactNode;
  role?: Role;
  variant?: "outline" | "solid" | "muted";
  glyph?: string;
  className?: string;
}) {
  return (
    <span
      data-role={role}
      data-variant={variant}
      className={cn("sw-status-pill", className)}
    >
      {glyph && <span style={{ fontSize: 9 }}>{glyph}</span>}
      <span>{children}</span>
    </span>
  );
}
