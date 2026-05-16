import { cn } from "@/lib/utils";

/**
 * Wrapper that visually joins a row of <Cell>s. The cells themselves
 * use -mr-px / -mb-px on each child to collapse touching borders, so
 * this only adds left/top compensation to keep the outer edge flush.
 */
export function ButtonGroup({
  children,
  vertical = false,
  className,
}: {
  children: React.ReactNode;
  vertical?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex",
        vertical ? "flex-col" : "flex-row",
        // ensures the bottom-right -1px doesn't visually clip
        "pr-px pb-px",
        className
      )}
    >
      {children}
    </div>
  );
}
