import { cn } from "@/lib/utils";
import { formatPriceUSD } from "@/lib/format";

interface FlowBarProps {
  inflow: number;
  outflow: number;
  className?: string;
}

export function FlowBar({ inflow, outflow, className }: FlowBarProps) {
  const total = inflow + outflow;
  if (total === 0) {
    return (
      <div className={cn("h-2 w-full rounded-full bg-bg-elevated", className)} />
    );
  }
  const inflowPct = (inflow / total) * 100;
  const isNetPositive = inflow >= outflow;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-bg-elevated">
        <div
          className="bg-accent-green transition-all"
          style={{ width: `${inflowPct}%` }}
        />
        <div
          className="bg-danger transition-all"
          style={{ width: `${100 - inflowPct}%` }}
        />
      </div>
      <span
        className={cn(
          "text-xs font-mono font-medium",
          isNetPositive ? "text-accent-green" : "text-danger"
        )}
      >
        {isNetPositive ? "+" : "-"}${formatPriceUSD(Math.abs(inflow - outflow)).replace("$", "")}
      </span>
    </div>
  );
}
