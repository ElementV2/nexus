import { cn } from "@/lib/utils";

export function Section({
  children,
  className,
  pad = true,
  noBorder = false,
}: {
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
  noBorder?: boolean;
}) {
  return (
    <section
      className={cn(
        "sw-section",
        !pad && "sw-section--nopad",
        noBorder && "sw-section--noborder",
        className
      )}
    >
      {children}
    </section>
  );
}
