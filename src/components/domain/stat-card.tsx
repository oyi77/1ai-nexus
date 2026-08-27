import { cn, formatPercent } from "@/lib/utils";
import { type ReactNode } from "react";
import { Explain } from "@/components/primitives/Explain";

interface StatCardProps {
  label: string
  value: string | number
  change?: number
  icon?: ReactNode
  explain?: string
  className?: string
}

export function StatCard({ label, value, change, icon, explain, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-white/5 bg-bg-surface p-4",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
          {label}
        </span>
        {explain && <Explain text={explain} />}
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono text-text-primary">
          {value}
        </span>
        {change !== undefined && (
          <span
            className={cn(
              "text-sm font-mono",
              change >= 0 ? "text-accent-green" : "text-danger"
            )}
          >
            {formatPercent(change)}
          </span>
        )}
      </div>
    </div>
  );
}
