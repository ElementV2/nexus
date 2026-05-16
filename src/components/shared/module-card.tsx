"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModuleCardProps {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  disabled?: boolean;
}

export function ModuleCard({
  title,
  description,
  href,
  icon: Icon,
  accent,
  disabled,
}: ModuleCardProps) {
  const content = (
    <div
      className={cn(
        "group flex items-center gap-3 transition-colors",
        disabled ? "opacity-35 cursor-not-allowed" : "cursor-pointer"
      )}
      style={{
        padding: "10px 12px",
        background: "var(--card)",
        border: "1px solid var(--line)",
        transitionDuration: "80ms",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--card-hi)";
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--card)";
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 28,
          height: 28,
          border: `1px solid ${accent}`,
          color: accent,
        }}
      >
        <Icon size={14} strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <h3
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 11,
            color: "var(--muted)",
            lineHeight: 1.3,
            marginTop: 1,
          }}
        >
          {description}
        </p>
      </div>
      <svg
        width={12}
        height={12}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        style={{ color: "var(--sub)", flexShrink: 0 }}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );

  if (disabled) return content;
  return <Link href={href}>{content}</Link>;
}
