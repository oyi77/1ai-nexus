"use client"

import { useState, useCallback } from 'react'

interface AddressChipProps {
  address: string
  label?: string
  truncate?: number
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

export function AddressChip({
  address,
  label,
  truncate = 6,
  size = 'sm',
  className = '',
}: AddressChipProps) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [address])

  const sizeClass = {
    xs: 'text-xs px-1 py-0',
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-[12px] px-2 py-1',
  }[size]

  const display = label || `${address.slice(0, truncate)}…${address.slice(-truncate)}`

  return (
    <button
      onClick={copy}
      className={`font-mono inline-flex items-center gap-1 rounded bg-bg-raised border border-bg-border
        hover:border-teal-muted/50 transition-colors cursor-pointer ${sizeClass} ${className}`}
      title={address}
    >
      <span className="text-text-primary truncate">{display}</span>
      {copied && <span className="text-teal-vivid text-xs">✓</span>}
    </button>
  )
}
