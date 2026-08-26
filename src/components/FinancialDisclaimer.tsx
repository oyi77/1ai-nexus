"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface FinancialDisclaimerProps {
  variant?: 'banner' | 'modal' | 'inline'
  onAccept?: () => void
}

export function FinancialDisclaimer({ variant = 'banner', onAccept }: FinancialDisclaimerProps) {
  const [dismissed, setDismissed] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    const hasAccepted = localStorage.getItem('financial-disclaimer-accepted')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasAccepted) setAccepted(true)
  }, [])

  const handleAccept = () => {
    localStorage.setItem('financial-disclaimer-accepted', 'true')
    setAccepted(true)
    onAccept?.()
  }

  if (accepted && variant !== 'inline') return null

  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="bg-bg-panel border border-border-dim rounded-lg p-6 max-w-md mx-4">
          <h3 className="text-lg font-bold text-data-bear mb-4">⚠️ Financial Disclaimer</h3>
          <p className="text-sm text-text-secondary mb-4">
            The signals and analysis provided are for <strong>educational and informational purposes only</strong>.
            They do NOT constitute financial advice.
          </p>
          <p className="text-sm text-text-secondary mb-4">
            Trading cryptocurrencies involves significant risk. Past performance does not guarantee future results.
            You may lose your entire investment.
          </p>
          <p className="text-sm text-text-secondary mb-6">
            By continuing, you acknowledge that you understand the risks and agree to our{' '}
            <a href="/terms" className="text-accent-cyan underline">Terms of Service</a>.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleAccept}
              className="flex-1 px-4 py-2 bg-teal-vivid text-bg-base font-bold rounded hover:bg-teal-vivid/80 transition-colors"
            >
              I Understand the Risks
            </button>
            <Link
              href="/"
              className="px-4 py-2 bg-bg-raised text-text-muted font-mono rounded hover:text-text-primary transition-colors"
            >
              Leave
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'inline') {
    return (
      <div className="bg-data-bear/10 border border-data-bear/30 rounded-lg p-3 text-xs text-text-muted font-mono">
        <strong className="text-data-bear">Disclaimer:</strong> Signals are for informational purposes only.
        Not financial advice. <a href="/terms" className="text-accent-cyan underline">Terms</a>
      </div>
    )
  }

  // Banner variant
  if (dismissed) return null

  return (
    <div className="bg-data-bear/10 border-b border-data-bear/30 px-4 py-2 flex items-center justify-between">
      <p className="text-xs text-text-muted">
        <strong className="text-data-bear">⚠️ Not Financial Advice:</strong> Signals are for educational purposes only.
        Trading involves risk. <a href="/terms" className="text-accent-cyan underline">Learn more</a>
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="text-xs text-text-muted hover:text-text-primary font-mono ml-4"
      >
        Dismiss
      </button>
    </div>
  )
}
