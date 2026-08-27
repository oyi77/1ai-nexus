"use client"

// §3 — TierBadge
// Lightweight, DB-free visual token for any graded/lettered/market datum
// (e.g. intel-score grade A/B/C/D, risk tier). Renders a small rounded chip.
// Reuses the project's existing badge style: rounded bg-bg-raised px-1.5 py-0.5 text-xs text-text-muted

interface TierBadgeProps {
  label: string
  color?: string
  className?: string
}

export function TierBadge({ label, color, className = "" }: TierBadgeProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded bg-bg-raised px-1.5 py-0.5 text-xs font-bold tracking-wide text-text-muted ${className}`}
      style={color ? { color } : undefined}
    >
      {label}
    </span>
  )
}
