import { cn } from "@/lib/utils";

export function HairlineRow({
  state = "default",
  className,
  children,
  ...rest
}: {
  state?: "default" | "pgm" | "pvw";
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div
      data-state={state}
      className={cn("sw-hairline-row", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
