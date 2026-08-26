"use client"

interface AlertPillProps {
  severity: 'critical' | 'high' | 'medium' | 'low'
  label?: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

const SEVERITY_CONFIG = {
  critical: { icon: '🔴', color: 'text-data-bear',   bg: 'bg-data-bear/15',  border: 'border-data-bear/30' },
  high:     { icon: '🟠', color: 'text-data-warn',   bg: 'bg-data-warn/15',  border: 'border-data-warn/30' },
  medium:   { icon: '🟡', color: 'text-data-warn',   bg: 'bg-data-warn/10',  border: 'border-data-warn/20' },
  low:      { icon: '🔵', color: 'text-data-info',   bg: 'bg-data-info/10',  border: 'border-data-info/20' },
} as const

export function AlertPill({
  severity,
  label,
  size = 'sm',
  className = '',
}: AlertPillProps) {
  const config = SEVERITY_CONFIG[severity]
  const sizeClass = {
    xs: 'text-xs px-1 py-0',
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-[12px] px-2 py-1',
  }[size]

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-mono uppercase tracking-wider
        ${config.color} ${config.bg} ${config.border} ${sizeClass} ${className}`}
    >
      <span>{config.icon}</span>
      <span>{label || severity}</span>
    </span>
  )
}
