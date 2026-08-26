"use client"

import { useState, useCallback } from 'react'

interface TxHashProps {
  hash: string
  explorerUrl?: string
  truncate?: number
  className?: string
}

export function TxHash({
  hash,
  explorerUrl = 'https://etherscan.io/tx/',
  truncate = 6,
  className = '',
}: TxHashProps) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(hash)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [hash])

  const display = `${hash.slice(0, truncate)}…${hash.slice(-truncate)}`

  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs ${className}`}>
      <button
        onClick={copy}
        className="text-data-info hover:text-data-info/80 transition-colors cursor-pointer"
        title={hash}
      >
        {display}
      </button>
      {copied && <span className="text-teal-vivid text-xs">✓</span>}
      <a
        href={`${explorerUrl}${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-text-muted hover:text-data-info transition-colors text-xs"
        title="View on explorer"
      >
        ↗
      </a>
    </span>
  )
}
