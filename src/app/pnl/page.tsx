"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Search } from "lucide-react"

interface WalletPnl {
  address: string
  chain: string
  totalPnl: number
  winRate: number
  tradeCount: number
  avgTradeSize: number
  bestTrade: number
  worstTrade: number
}

function formatPnl(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000).toFixed(1)}K`
  return `${value < 0 ? '-' : ''}$${abs.toFixed(2)}`
}

function formatAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function PnlPage() {
  const [wallets, setWallets] = useState<WalletPnl[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [lookupAddr, setLookupAddr] = useState('')
  const [lookupChain, setLookupChain] = useState('eth')
  const [singleWallet, setSingleWallet] = useState<WalletPnl | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/pnl?leaderboard=true&limit=50')
      const json = await res.json()
      const payload = (json && typeof json === 'object' && 'data' in json && 'error' in json) ? json.data : json
      setWallets(payload?.wallets ?? [])
    } catch {
      // Silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const invoke = () => fetchLeaderboard()
    invoke()
    const id = setInterval(fetchLeaderboard, 5 * 60_000) // refresh every 5 min
    return () => clearInterval(id)
  }, [fetchLeaderboard])

  const lookupWallet = async () => {
    if (!lookupAddr.trim()) return
    setLookupLoading(true)
    try {
      const res = await fetch(`/api/v1/pnl?address=${encodeURIComponent(lookupAddr)}&chain=${lookupChain}`)
      const data = await res.json()
      setSingleWallet(data.data ?? null)
    } catch {
      setSingleWallet(null)
    } finally {
      setLookupLoading(false)
    }
  }

  const filtered = wallets.filter(w =>
    !search ||
    w.address.toLowerCase().includes(search.toLowerCase()) ||
    w.chain.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <NexusLayout>
      <div className="h-full overflow-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-bold text-accent-cyan">WALLET PnL TRACKER</h1>
          <span className="text-[10px] text-text-muted">{wallets.length} wallets tracked</span>
        </div>

        {/* Wallet Lookup */}
        <div className="bg-bg-panel border border-border-dim rounded">
          <div className="px-3 py-2 border-b border-border-dim">
            <span className="text-xs font-mono text-accent-cyan">WALLET LOOKUP</span>
          </div>
          <div className="p-3">
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={lookupAddr}
                onChange={e => setLookupAddr(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && lookupWallet()}
                placeholder="Enter wallet address (0x...)"
                className="flex-1 bg-bg-deep border border-border-dim rounded px-3 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
              />
              <select
                value={lookupChain}
                onChange={e => setLookupChain(e.target.value)}
                className="bg-bg-deep border border-border-dim rounded px-2 py-1.5 text-xs font-mono text-text-primary focus:border-accent-cyan focus:outline-none"
              >
                <option value="eth">ETH</option>
                <option value="arb">ARB</option>
                <option value="base">BASE</option>
                <option value="op">OP</option>
                <option value="polygon">POLYGON</option>
                <option value="bsc">BSC</option>
              </select>
              <button
                onClick={lookupWallet}
                disabled={lookupLoading || !lookupAddr.trim()}
                className="px-4 py-1.5 bg-accent-cyan/20 text-accent-cyan text-xs font-mono rounded border border-accent-cyan/30 hover:bg-accent-cyan/30 disabled:opacity-50 transition-colors"
              >
                {lookupLoading ? 'Calculating...' : 'CALCULATE'}
              </button>
            </div>

            {singleWallet && (
              <div className="bg-bg-elevated rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-text-primary">{formatAddress(singleWallet.address)}</span>
                  <span className="text-[10px] text-accent-cyan">{singleWallet.chain.toUpperCase()}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-text-dim">Total PnL</span>
                    <p className={`font-mono font-bold ${singleWallet.totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {formatPnl(singleWallet.totalPnl)}
                    </p>
                  </div>
                  <div>
                    <span className="text-text-dim">Win Rate</span>
                    <p className="font-mono text-text-primary">{(singleWallet.winRate * 100).toFixed(1)}%</p>
                  </div>
                  <div>
                    <span className="text-text-dim">Trades</span>
                    <p className="font-mono text-text-primary">{singleWallet.tradeCount}</p>
                  </div>
                  <div>
                    <span className="text-text-dim">Avg Size</span>
                    <p className="font-mono text-text-primary">{formatPnl(singleWallet.avgTradeSize)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Leaderboard */}
        <div className="bg-bg-panel border border-border-dim rounded">
          <div className="px-3 py-2 border-b border-border-dim flex items-center justify-between">
            <span className="text-xs font-mono text-accent-cyan">TOP 50 WALLETS BY PnL</span>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filter..."
                  className="bg-bg-deep border border-border-dim rounded pl-7 pr-2 py-1 text-[10px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none w-32"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-4 text-text-dim text-xs text-center">Loading leaderboard...</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-text-dim text-xs text-center">No wallet data available</div>
          ) : (
            <div className="overflow-auto scrollbar-thin" style={{ maxHeight: '600px' }}>
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-text-muted">
                    <th className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-border-dim sticky top-0 bg-bg-deep z-10 text-left w-12">Rank</th>
                    <th className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-border-dim sticky top-0 bg-bg-deep z-10 text-left">Address</th>
                    <th className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-border-dim sticky top-0 bg-bg-deep z-10 text-left w-20">Chain</th>
                    <th className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-border-dim sticky top-0 bg-bg-deep z-10 text-right">Total PnL</th>
                    <th className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-border-dim sticky top-0 bg-bg-deep z-10 text-right hidden sm:table-cell">Win Rate</th>
                    <th className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-border-dim sticky top-0 bg-bg-deep z-10 text-right hidden md:table-cell">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((w, i) => (
                    <tr
                      key={`${w.address}-${w.chain}`}
                      className="border-b border-border-dim/30 hover:bg-bg-elevated transition-colors cursor-pointer"
                      onClick={() => {
                        setLookupAddr(w.address)
                        setLookupChain(w.chain)
                      }}
                    >
                      <td className="text-[11px] font-mono px-2 py-0.5 text-text-muted">{i + 1}</td>
                      <td className="text-[11px] font-mono px-2 py-0.5 text-text-primary whitespace-nowrap overflow-hidden text-ellipsis" style={{ maxWidth: '200px' }}>
                        {formatAddress(w.address)}
                      </td>
                      <td className="text-[11px] font-mono px-2 py-0.5 text-accent-cyan">{w.chain.toUpperCase()}</td>
                      <td className={`text-[11px] font-mono px-2 py-0.5 text-right font-bold ${w.totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        {formatPnl(w.totalPnl)}
                      </td>
                      <td className="text-[11px] font-mono px-2 py-0.5 text-right text-text-primary hidden sm:table-cell">
                        {(w.winRate * 100).toFixed(1)}%
                      </td>
                      <td className="text-[11px] font-mono px-2 py-0.5 text-right text-text-primary hidden md:table-cell">
                        {w.tradeCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </NexusLayout>
  )
}
