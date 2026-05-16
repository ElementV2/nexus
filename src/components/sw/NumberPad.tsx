import { cn } from "@/lib/utils";
import { Cell, type CellRole } from "./Cell";

/**
 * Grid of numbered cells — used for event lists, frame jumps, camera
 * selectors, quick marks. Cells share borders via the standard Cell
 * pattern (-mr-px / -mb-px).
 */
export function NumberPad({
  values,
  cols,
  active,
  role = "red",
  onSelect,
  className,
}: {
  values: (string | number)[];
  cols: number;
  active?: (string | number) | (string | number)[];
  role?: CellRole;
  onSelect?: (v: string | number) => void;
  className?: string;
}) {
  const isActive = (v: string | number) =>
    Array.isArray(active) ? active.includes(v) : active === v;

  return (
    <div
      className={cn("grid pr-px pb-px", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {values.map((v) => (
        <Cell
          key={String(v)}
          active={isActive(v)}
          role={role}
          onClick={() => onSelect?.(v)}
        >
          {v}
        </Cell>
      ))}
    </div>
  );
}
