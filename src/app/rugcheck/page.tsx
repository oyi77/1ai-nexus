"use client"

import { useState, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'

interface RugCheckResult {
  address: string
  chain: string
  riskScore: number
  riskLevel: string
  checks: Array<{ name: string; passed: boolean; detail: string; weight: number }>
  summary: string
}

export default function RugcheckPage() {
  const [address, setAddress] = useState('')
  const [chain, setChain] = useState('eth')
  const [result, setResult] = useState<RugCheckResult | null>(null)
  const [loading, setLoading] = useState(false)

  const check = useCallback(async () => {
    if (!address.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/rugcheck?address=${address}&chain=${chain}`)
      const data = await res.json()
      setResult(data.data)
    } catch {
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [address, chain])

  const riskColor = (level: string) => {
    switch (level) {
      case 'SAFE': return 'text-data-bull'
      case 'CAUTION': return 'text-data-warn'
      case 'DANGER': return 'text-data-orange'
      case 'SCAM': return 'text-data-bear'
      default: return 'text-data-neutral'
    }
  }

  const riskBg = (level: string) => {
    switch (level) {
      case 'SAFE': return 'bg-data-bull'
      case 'CAUTION': return 'bg-data-warn'
      case 'DANGER': return 'bg-data-orange'
      case 'SCAM': return 'bg-data-bear'
      default: return 'bg-data-neutral'
    }
  }

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">🛡 RugCheck</h1>
            <p className="text-[11px] text-text-muted font-mono">Honeypot / rug pull detector — check any token before buying</p>
          </div>
        </div>

        {/* Search */}
        <Panel title="Token Safety Check" subtitle="Enter a token contract address">
          <div className="p-3 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="0x... or token address"
                className="flex-1 bg-bg-raised border border-bg-border rounded px-3 py-2 text-[12px] font-mono text-text-primary placeholder:text-text-muted outline-none"
              />
              <select value={chain} onChange={e => setChain(e.target.value)} className="bg-bg-raised border border-bg-border rounded px-3 py-2 text-[12px] font-mono text-text-primary">
                <option value="eth">Ethereum</option>
                <option value="bsc">BNB Chain</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="base">Base</option>
                <option value="solana">Solana</option>
              </select>
              <button onClick={check} disabled={loading} className="px-4 py-2 bg-teal-vivid text-bg-base rounded font-mono font-bold text-[12px] disabled:opacity-50">
                {loading ? '...' : 'CHECK'}
              </button>
            </div>
          </div>
        </Panel>

        {/* Result */}
        {result && (
          <>
            <Panel title="Safety Score" subtitle={result.summary}>
              <div className="p-4 text-center">
                <div className={`text-[48px] font-head font-bold tabular-nums ${riskColor(result.riskLevel)}`}>
                  {result.riskScore}
                </div>
                <div className={`text-[18px] font-head font-bold ${riskColor(result.riskLevel)}`}>
                  {result.riskLevel}
                </div>
                {/* Score bar */}
                <div className="mt-3 h-3 bg-bg-border rounded-full overflow-hidden max-w-xs mx-auto">
                  <div className={`h-full rounded-full transition-all ${riskBg(result.riskLevel)}`} style={{ width: `${result.riskScore}%` }} />
                </div>
              </div>
            </Panel>

            <Panel title="Risk Factors" subtitle={`${result.checks.length} checks performed`}>
              <div className="space-y-0">
                {result.checks.map((check, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 border-b border-bg-border/50">
                    <span className={`text-[14px] ${check.passed ? 'text-data-bull' : 'text-data-bear'}`}>
                      {check.passed ? '✅' : '⚠️'}
                    </span>
                    <div className="flex-1">
                      <div className="text-[12px] font-medium text-text-primary">{check.name}</div>
                      <div className="text-[10px] text-text-muted">{check.detail}</div>
                    </div>
                    {check.weight > 0 && (
                      <span className="text-[10px] font-mono text-data-bear">+{check.weight} risk</span>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </NexusLayout>
  )
}
