import { cn } from "@/lib/utils";

/**
 * Mono uppercase label — section captions, eyebrows, ToolbarSlot
 * headers. Built on the global `.label` class so the entire app
 * shares one definition for that pattern.
 */
export function Eyebrow({
  children,
  tone = "muted",
  className,
}: {
  children: React.ReactNode;
  tone?: "muted" | "red" | "green" | "amber" | "blue" | "purple" | "text";
  className?: string;
}) {
  const color =
    tone === "red"
      ? "var(--pgm)"
      : tone === "green"
        ? "var(--pvw)"
        : tone === "amber"
          ? "var(--amber)"
          : tone === "blue"
            ? "var(--cyan)"
            : tone === "purple"
              ? "var(--purple)"
              : tone === "text"
                ? "var(--ink)"
                : "var(--muted)";

  return (
    <div
      className={cn("label", className)}
      style={tone !== "muted" ? { color } : undefined}
    >
      {children}
    </div>
  );
}
