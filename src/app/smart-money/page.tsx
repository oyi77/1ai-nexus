"use client"

import { useState, useEffect } from "react"
import { TerminalShell } from "@/components/layout/TerminalShell"

interface CategoryFlow {
  category: string
  label: string
  icon: string
  entityCount: number
  chains: string[]
}

interface WalletProfile {
  address: string
  chain: string
  entity: { label: string; category: string; confidence: number } | null
  txCount: number
  tokenTransferCount: number
}

export default function SmartMoneyPage() {
  const [flows, setFlows] = useState<CategoryFlow[]>([])
  const [totalEntities, setTotalEntities] = useState(0)
  const [walletAddress, setWalletAddress] = useState('')
  const [walletProfile, setWalletProfile] = useState<WalletProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [walletLoading, setWalletLoading] = useState(false)

  useEffect(() => {
    fetch('/api/v1/smart-money/flow')
      .then(r => r.json())
      .then(d => {
        setFlows(d.flows ?? [])
        setTotalEntities(d.totalEntities ?? 0)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const analyzeWallet = async () => {
    if (!walletAddress.trim()) return
    setWalletLoading(true)
    try {
      const res = await fetch(`/api/v1/smart-money/wallet?address=${encodeURIComponent(walletAddress)}&chain=eth`)
      const data = await res.json()
      setWalletProfile(data)
    } catch {
      setWalletProfile(null)
    } finally {
      setWalletLoading(false)
    }
  }

  return (
    <TerminalShell>
      <div className="h-full overflow-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan">SMART MONEY TRACKER</h1>
          <span className="text-[10px] text-text-muted">{totalEntities} entities tracked</span>
        </div>

        {/* Smart Money Flow Board */}
        <div className="bg-bg-panel border border-border-dim rounded">
          <div className="px-3 py-2 border-b border-border-dim">
            <span className="text-xs font-mono text-accent-cyan">ENTITY FLOW BOARD</span>
          </div>
          {loading ? (
            <div className="p-4 text-text-dim text-xs text-center">Loading entity data...</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 p-3">
              {flows.map(f => (
                <div key={f.category} className="bg-bg-elevated rounded p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span>{f.icon}</span>
                    <span className="text-[10px] text-text-muted uppercase">{f.label}</span>
                  </div>
                  <p className="text-lg font-mono font-bold text-text-primary">{f.entityCount}</p>
                  <p className="text-[9px] text-text-dim">{f.chains.join(', ').toUpperCase()}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Wallet Profiler */}
        <div className="bg-bg-panel border border-border-dim rounded">
          <div className="px-3 py-2 border-b border-border-dim">
            <span className="text-xs font-mono text-accent-cyan">WALLET PROFILER</span>
          </div>
          <div className="p-3">
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={walletAddress}
                onChange={e => setWalletAddress(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && analyzeWallet()}
                placeholder="Enter ETH address (0x...) or SOL address"
                className="flex-1 bg-bg-deep border border-border-dim rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
              />
              <button
                onClick={analyzeWallet}
                disabled={walletLoading || !walletAddress.trim()}
                className="px-4 py-1.5 bg-accent-cyan/20 text-accent-cyan text-xs font-mono rounded border border-accent-cyan/30 hover:bg-accent-cyan/30 disabled:opacity-50 transition-colors"
              >
                {walletLoading ? 'Analyzing...' : 'ANALYZE'}
              </button>
            </div>

            {walletProfile && (
              <div className="bg-bg-elevated rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-text-primary">{walletProfile.address.slice(0, 8)}...{walletProfile.address.slice(-6)}</span>
                  <span className="text-[10px] text-accent-cyan">{walletProfile.chain.toUpperCase()}</span>
                </div>
                {walletProfile.entity ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-accent-green font-mono">{walletProfile.entity.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-panel text-text-dim">{walletProfile.entity.category}</span>
                    <span className="text-[10px] text-text-muted">({(walletProfile.entity.confidence * 100).toFixed(0)}% confidence)</span>
                  </div>
                ) : (
                  <span className="text-xs text-text-dim">Unknown entity — not in label database</span>
                )}
                <div className="flex gap-4 text-xs">
                  <span className="text-text-dim">TXs: <span className="text-text-primary font-mono">{walletProfile.txCount}</span></span>
                  <span className="text-text-dim">Token transfers: <span className="text-text-primary font-mono">{walletProfile.tokenTransferCount}</span></span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Top Entities by Category */}
        <div className="bg-bg-panel border border-border-dim rounded">
          <div className="px-3 py-2 border-b border-border-dim">
            <span className="text-xs font-mono text-accent-cyan">TRACKED ENTITIES BY CATEGORY</span>
          </div>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {flows.map(f => (
              <div key={f.category} className="bg-bg-elevated rounded p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span>{f.icon}</span>
                  <span className="text-xs font-mono text-text-primary">{f.label}</span>
                  <span className="text-[10px] text-text-muted ml-auto">{f.entityCount}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {f.chains.map(c => (
                    <span key={c} className="text-[9px] px-1 py-0.5 rounded bg-bg-panel text-accent-cyan">{c.toUpperCase()}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </TerminalShell>
  )
}
