"use client"

interface EntityLabelProps {
  type: 'whale' | 'dex' | 'cex' | 'contract' | 'unknown' | 'fund' | 'mev' | 'protocol'
  label?: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

const ENTITY_CONFIG = {
  whale:    { icon: '🐋', color: 'text-data-purple', bg: 'bg-data-purple/10' },
  dex:      { icon: '🔄', color: 'text-data-orange', bg: 'bg-data-orange/10' },
  cex:      { icon: '🏦', color: 'text-data-info',   bg: 'bg-data-info/10' },
  contract: { icon: '📝', color: 'text-data-neutral', bg: 'bg-data-neutral/10' },
  unknown:  { icon: '❓', color: 'text-text-muted',  bg: 'bg-text-muted/10' },
  fund:     { icon: '💼', color: 'text-data-purple', bg: 'bg-data-purple/10' },
  mev:      { icon: '⚡', color: 'text-data-warn',   bg: 'bg-data-warn/10' },
  protocol: { icon: '📜', color: 'text-teal-vivid',  bg: 'bg-teal-vivid/10' },
} as const

export function EntityLabel({
  type,
  label,
  size = 'sm',
  className = '',
}: EntityLabelProps) {
  const config = ENTITY_CONFIG[type] || ENTITY_CONFIG.unknown
  const sizeClass = {
    xs: 'text-xs px-1 py-0',
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-[12px] px-2 py-1',
  }[size]

  return (
    <span
      className={`inline-flex items-center gap-1 rounded ${config.color} ${config.bg} ${sizeClass} ${className}`}
    >
      <span>{config.icon}</span>
      <span className="font-mono">{label || type.toUpperCase()}</span>
    </span>
  )
}
