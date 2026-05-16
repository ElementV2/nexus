import { cn } from "@/lib/utils";
import { forwardRef } from "react";

export const MonoInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function MonoInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cn("sw-input", className)} {...rest} />;
});

export function SetButton({
  children = "Set",
  variant = "default",
  className,
  ...rest
}: {
  children?: React.ReactNode;
  variant?: "default" | "red";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-active="true"
      data-role={variant === "red" ? "red" : "default"}
      className={cn("sw-cell", className)}
      style={{ marginLeft: -1, marginRight: 0, marginBottom: 0 }}
      {...rest}
    >
      {children}
    </button>
  );
}
