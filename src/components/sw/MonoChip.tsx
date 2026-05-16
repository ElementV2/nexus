import { cn } from "@/lib/utils";

export function MonoChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("sw-mono-chip", className)}>{children}</span>;
}
