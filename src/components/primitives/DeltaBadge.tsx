"use client"

interface DeltaBadgeProps {
  value: number
  decimals?: number
  size?: 'xs' | 'sm' | 'md'
  showSign?: boolean
  className?: string
}

export function DeltaBadge({
  value,
  decimals = 2,
  size = 'sm',
  showSign = true,
  className = '',
}: DeltaBadgeProps) {
  const isPositive = value > 0
  const isNegative = value < 0
  const isZero = value === 0

  const colorClass = isPositive
    ? 'text-data-bull'
    : isNegative
    ? 'text-data-bear'
    : 'text-data-neutral'

  const sizeClass = {
    xs: 'text-xs px-1',
    sm: 'text-xs px-1.5',
    md: 'text-[12px] px-2',
  }[size]

  const sign = showSign && isPositive ? '+' : ''
  const formatted = `${sign}${value.toFixed(decimals)}%`

  return (
    <span
      className={`font-mono tabular-nums inline-flex items-center ${colorClass} ${sizeClass} ${className}`}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {isZero ? '—' : formatted}
    </span>
  )
}
