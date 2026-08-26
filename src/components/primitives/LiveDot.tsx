"use client"

interface LiveDotProps {
  status: 'live' | 'stale' | 'error' | 'disconnected'
  size?: number
  label?: boolean
  className?: string
}

export function LiveDot({
  status,
  size = 6,
  label = false,
  className = '',
}: LiveDotProps) {
  const colorMap = {
    live:         'bg-data-bull',
    stale:        'bg-data-warn',
    error:        'bg-data-bear',
    disconnected: 'bg-data-bear',
  }

  const labelMap = {
    live:         'LIVE',
    stale:        'STALE',
    error:        'ERROR',
    disconnected: 'OFFLINE',
  }

  const pulseClass = status === 'live' ? 'animate-live-dot' : ''

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        className={`inline-block rounded-full ${colorMap[status]} ${pulseClass}`}
        style={{ width: size, height: size }}
      />
      {label && (
        <span className="text-xs font-mono text-text-secondary uppercase tracking-wider">
          {labelMap[status]}
        </span>
      )}
    </span>
  )
}
