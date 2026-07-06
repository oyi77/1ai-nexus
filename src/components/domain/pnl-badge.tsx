import { cn } from "@/lib/utils";

interface PnlBadgeProps {
  value: number;
  className?: string;
}

export function PnlBadge({ value, className }: PnlBadgeProps) {
  const isPositive = value >= 0;
  const abs = Math.abs(value);

  // Adapt decimals to magnitude: micro PnL gets more precision
  let decimals = 2;
  if (abs < 0.01) decimals = 4;
  else if (abs < 1) decimals = 3;
  else if (abs >= 100) decimals = 1;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-medium",
        isPositive
          ? "bg-accent-green/10 text-accent-green"
          : "bg-danger/10 text-danger",
        className
      )}
    >
      {isPositive ? "+" : ""}
      {value.toFixed(decimals)}%
    </span>
  );
}
