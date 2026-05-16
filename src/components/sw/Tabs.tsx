import { cn } from "@/lib/utils";
import { ButtonGroup } from "./ButtonGroup";
import { Cell } from "./Cell";

/**
 * Segmented control built on the same Cell/ButtonGroup primitives so
 * the rhythm matches everywhere. Active = solid role-color, others =
 * transparent with line-2 border.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  role = "red",
  className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  role?: "red" | "green" | "amber" | "blue" | "purple";
  className?: string;
}) {
  return (
    <ButtonGroup className={cn(className)}>
      {options.map((opt) => (
        <Cell
          key={opt.value}
          active={value === opt.value}
          role={role}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Cell>
      ))}
    </ButtonGroup>
  );
}
