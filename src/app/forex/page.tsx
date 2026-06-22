"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

export default function ForexPage() {
  const [rates, setRates] = useState<Record<string, number> | null>(null)
  const [base, setBase] = useState('USD')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const reset = () => { setError(null); setLoading(true) }
    reset()
    fetch(`/api/v1/modules/fetch?module=exchangerate-api&base=${base}`)
      .then(r => r.json())
      .then(d => { setRates(d.data?.rates ?? null); setLoading(false) })
      .catch((err) => { setLoading(false); setError((err as Error).message) })
  }, [base])

  const majorPairs = ['EUR', 'GBP', 'JPY', 'CHF', 'CNY', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD']

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">FOREX RATES</h1>
          <div className="flex gap-2">
            {['USD', 'EUR', 'GBP'].map(b => (
              <button
                key={b}
                onClick={() => setBase(b)}
                className={`px-2 py-0.5 rounded text-xs border font-mono transition-colors ${
                  base === b
                    ? 'bg-border-active border-border-active text-text-primary'
                    : 'bg-bg-panel border-border-dim text-text-dim hover:border-border-active'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="text-data-bear text-[11px] font-mono p-4">Error: {error}</div>}

        {loading ? (
          <div className="text-text-dim text-xs">Loading FX rates...</div>
        ) : rates ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {majorPairs.filter(c => c !== base).map(currency => (
              <div key={currency} className="bg-bg-panel border border-border-dim rounded-lg p-3">
                <p className="text-[10px] text-text-muted uppercase">{base}/{currency}</p>
                <p className="text-lg font-mono font-bold text-text-primary">
                  {rates[currency]?.toFixed(4) ?? '—'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-text-dim text-xs">Failed to load FX rates</div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            ExchangeRate-API (open.er-api.com) — 160 currencies, ECB reference rates via Frankfurter module
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
