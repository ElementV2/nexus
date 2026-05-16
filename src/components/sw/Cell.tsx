import { cn } from "@/lib/utils";

export type CellRole =
  | "default"
  | "red"
  | "green"
  | "amber"
  | "blue"
  | "purple";

/**
 * Single bordered cell. Visual styling lives in components.css under
 * `.sw-cell` so Tailwind v4's arbitrary-border quirks can't break it.
 */
export function Cell({
  children,
  active = false,
  role = "default",
  disabled = false,
  className,
  ...rest
}: {
  children: React.ReactNode;
  active?: boolean;
  role?: CellRole;
  disabled?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-active={active ? "true" : "false"}
      data-role={role}
      className={cn("sw-cell", className)}
      {...rest}
    >
      {children}
    </button>
  );
}
