import { cn } from "@/lib/utils";

/**
 * Tactical Refined CTA — tinted active by default. Solid amber-tinted
 * background with amber border and amber label.
 */
export function PrimaryButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "font-mono uppercase transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className
      )}
      style={{
        padding: "10px 18px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "1.4px",
        background: "var(--amber-tint)",
        color: "var(--amber)",
        border: "1px solid var(--amber)",
        transitionDuration: "80ms",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Outline button: 1px border, ink text. Hover lifts to card-hi background.
 */
export function SecondaryButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "font-mono uppercase transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className
      )}
      style={{
        padding: "10px 18px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "1.4px",
        background: "var(--card)",
        color: "var(--ink)",
        border: "1px solid var(--line-hi)",
        transitionDuration: "80ms",
      }}
      onMouseEnter={(e) => {
        if (!e.currentTarget.disabled)
          e.currentTarget.style.background = "var(--card-hi)";
      }}
      onMouseLeave={(e) => {
        if (!e.currentTarget.disabled)
          e.currentTarget.style.background = "var(--card)";
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
