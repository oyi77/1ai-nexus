"use client"

import Link from 'next/link'
import { Lock } from 'lucide-react'

interface AuthGateProps {
  /** What the gated feature is shown as (e.g. "Backtest", "Alpha Signals") */
  feature: string
  /** Optional detail line */
  detail?: string
  /** Current authenticated state from useAuthGatedFetch */
  isAuthenticated: boolean
}

/**
 * Renders a "Sign in to unlock" panel when an auth-gated fetch returns 401.
 * Use as the empty state for premium panels so anonymous visitors see a
 * consistent call-to-action instead of a blank data table.
 */
export function AuthGate({ feature, detail, isAuthenticated }: AuthGateProps) {
  if (isAuthenticated) return null
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center border border-border-dim rounded-lg bg-bg-panel/50">
      <Lock className="w-6 h-6 text-text-muted mb-2" />
      <p className="text-sm text-text-primary font-mono font-bold">Sign in to unlock {feature}</p>
      {detail && <p className="text-xs text-text-muted mt-1">{detail}</p>}
      <Link
        href="/login"
        className="mt-3 px-3 py-1.5 text-xs font-mono bg-accent-cyan/20 text-accent-cyan rounded hover:bg-accent-cyan/30 transition-colors"
      >
        Sign in
      </Link>
    </div>
  )
}
