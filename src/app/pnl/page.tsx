"use client"

import { useState, useEffect, useCallback } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { TableControlsBar, SortableTh, useTableControls, type TableControlsColumn } from "@/components/shell/TableControls"

type WalletPnl = {
  address: string
  chain: string
  totalPnl: number
  winRate: number
  totalTrades: number
  avgTradeSize: number
  bestTrade: number
  worstTrade: number
  entityName?: string
  entityType?: string
  entityTvl?: number
  smartMoneyScore?: number
}

function formatUsd(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000).toFixed(1)}K`
  return `${value < 0 ? '-' : ''}$${abs.toFixed(2)}`
}

function formatAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

const typeColors: Record<string, string> = {
  exchange: 'bg-accent-amber/20 text-accent-amber',
  fund: 'bg-purple-400/20 text-purple-400',
  whale: 'bg-data-bull/20 text-data-bull',
  protocol: 'bg-teal-vivid/20 text-teal-vivid',
  bridge: 'bg-data-bear/20 text-data-bear',
}

export default function PnlPage() {
  const [wallets, setWallets] = useState<WalletPnl[]>([])
  const [loading, setLoading] = useState(true)
  const [lookupAddr, setLookupAddr] = useState('')
  const [lookupChain, setLookupChain] = useState('eth')
  const [singleWallet, setSingleWallet] = useState<WalletPnl | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/pnl?leaderboard=true&limit=50')
      const data = await res.json()
      const items = data.data?.wallets ?? []
      setWallets(items.map((w: Record<string, unknown>) => ({
        address: String(w.address ?? ''),
        chain: String(w.chain ?? 'ETHEREUM'),
        totalPnl: Number(w.totalPnl ?? 0),
        winRate: Number(w.winRate ?? 0),
        totalTrades: Number(w.totalTrades ?? 0),
        avgTradeSize: Number(w.avgTradeSize ?? 0),
        bestTrade: Number(w.bestTrade ?? 0),
        worstTrade: Number(w.worstTrade ?? 0),
        entityName: w.entityName ? String(w.entityName) : undefined,
        entityType: w.entityType ? String(w.entityType) : undefined,
        entityTvl: w.entityTvl ? Number(w.entityTvl) : undefined,
        smartMoneyScore: w.smartMoneyScore ? Number(w.smartMoneyScore) : undefined,
      })))
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchLeaderboard()
  }, [fetchLeaderboard])

  const lookupWallet = async () => {
    if (!lookupAddr.trim()) return
    setLookupLoading(true)
    try {
      const res = await fetch(`/api/v1/pnl?address=${encodeURIComponent(lookupAddr)}&chain=${lookupChain}`)
      const data = await res.json()
      setSingleWallet(data.data?.pnl ?? null)
    } catch {
      setSingleWallet(null)
    } finally {
      setLookupLoading(false)
    }
  }

  const pnlColumns: TableControlsColumn<WalletPnl>[] = [
    { key: 'entityName', accessor: w => w.entityName ?? w.address },
    { key: 'entityType', accessor: w => w.entityType ?? '' },
    { key: 'smartMoneyScore', accessor: w => w.smartMoneyScore ?? -Infinity },
    { key: 'entityTvl', accessor: w => w.entityTvl ?? -Infinity },
  ]

  // Replaces bespoke address/chain/entityName filter — hook fallback covers every field.
  const tc = useTableControls(wallets, pnlColumns)

  return (
    <NexusLayout>
      <div className="h-full overflow-auto p-4 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">💰 Smart Money Wallet Tracker</h1>
            <p className="text-[11px] text-text-muted font-mono mt-1">Top wallets ranked by Smart Money Score. Entity data from DeFiLlama.</p>
          </div>
          <div className="text-[10px] font-mono text-text-muted">{wallets.length} wallets tracked</div>
        </div>

        {/* Single Wallet Lookup */}
        <div className="bg-bg-panel border border-bg-border rounded p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] font-mono text-text-muted uppercase mb-1 block">Wallet Address</label>
              <input
                type="text"
                value={lookupAddr}
                onChange={e => setLookupAddr(e.target.value)}
                placeholder="0x..."
                className="w-full bg-bg-raised border border-bg-border rounded px-3 py-2 text-[12px] font-mono text-text-primary placeholder:text-text-muted focus:border-teal-vivid focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-text-muted uppercase mb-1 block">Chain</label>
              <select
                value={lookupChain}
                onChange={e => setLookupChain(e.target.value)}
                className="bg-bg-raised border border-bg-border rounded px-3 py-2 text-[12px] font-mono text-text-primary"
              >
                <option value="eth">Ethereum</option>
                <option value="bsc">BSC</option>
                <option value="polygon">Polygon</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="base">Base</option>
                <option value="solana">Solana</option>
              </select>
            </div>
            <button
              onClick={lookupWallet}
              disabled={lookupLoading}
              className="px-4 py-2 bg-teal-vivid text-bg-base rounded text-[11px] font-mono font-bold hover:bg-teal-vivid/80 transition-colors disabled:opacity-50"
            >
              {lookupLoading ? 'Scanning...' : 'Analyze'}
            </button>
          </div>

          {singleWallet && (
            <div className="mt-3 bg-bg-raised rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-mono text-text-primary font-bold">{formatAddress(singleWallet.address)}</span>
                <span className="text-[10px] font-mono text-teal-vivid">{singleWallet.chain}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-text-muted text-[10px] font-mono">Total PnL</span>
                  <p className={`font-mono font-bold ${singleWallet.totalPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                    {formatUsd(singleWallet.totalPnl)}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted text-[10px] font-mono">Win Rate</span>
                  <p className="font-mono text-text-primary">{(singleWallet.winRate * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <span className="text-text-muted text-[10px] font-mono">Trades</span>
                  <p className="font-mono text-text-primary">{singleWallet.totalTrades}</p>
                </div>
                <div>
                  <span className="text-text-muted text-[10px] font-mono">Avg Size</span>
                  <p className="font-mono text-text-primary">{formatUsd(singleWallet.avgTradeSize)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div className="bg-bg-panel border border-bg-border rounded">
          <div className="px-3 py-2 border-b border-bg-border flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold text-text-primary">TOP 50 WALLETS BY SMART MONEY SCORE</span>
          </div>

          {loading ? (
            <div className="p-8 text-text-muted text-[11px] font-mono text-center">Loading leaderboard...</div>
          ) : wallets.length === 0 ? (
            <div className="p-8 text-text-muted text-[11px] font-mono text-center">No wallet data available</div>
          ) : (
            <>
              <TableControlsBar idPrefix="pnl" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
            <div className="overflow-auto scrollbar-thin" style={{ maxHeight: '600px' }}>
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-text-muted">
                    <th className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-bg-border sticky top-0 bg-bg-base z-10 text-left w-12">Rank</th>
                    <SortableTh controls={tc} k="entityName" className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-bg-border sticky top-0 bg-bg-base z-10 text-left">Entity / Address</SortableTh>
                    <SortableTh controls={tc} k="chain" className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-bg-border sticky top-0 bg-bg-base z-10 text-left w-20">Chain</SortableTh>
                    <SortableTh controls={tc} k="entityType" className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-bg-border sticky top-0 bg-bg-base z-10 text-left w-20">Type</SortableTh>
                    <SortableTh controls={tc} k="smartMoneyScore" className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-bg-border sticky top-0 bg-bg-base z-10 text-right w-16">Score</SortableTh>
                    <SortableTh controls={tc} k="entityTvl" className="text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-bg-border sticky top-0 bg-bg-base z-10 text-right hidden sm:table-cell">TVL</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {tc.visible.map((w, i) => (
                    <tr
                      key={`${w.address}-${i}`}
                      className="border-b border-bg-border/30 hover:bg-bg-raised transition-colors cursor-pointer"
                      onClick={() => {
                        setLookupAddr(w.address)
                        setLookupChain(w.chain.toLowerCase())
                      }}
                    >
                      <td className="text-[11px] font-mono px-2 py-1.5 text-text-muted">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-col">
                          {w.entityName && (
                            <span className="text-[11px] font-mono font-bold text-text-primary">{w.entityName}</span>
                          )}
                          <span className="text-[10px] font-mono text-text-muted">{formatAddress(w.address)}</span>
                        </div>
                      </td>
                      <td className="text-[10px] font-mono px-2 py-1.5 text-teal-vivid">{w.chain}</td>
                      <td className="px-2 py-1.5">
                        {w.entityType && (
                          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${typeColors[w.entityType.toLowerCase()] ?? 'bg-bg-raised text-text-muted'}`}>
                            {w.entityType.toUpperCase()}
                          </span>
                        )}
                      </td>
                      <td className="text-[12px] font-mono px-2 py-1.5 text-right font-bold text-text-primary tabular-nums">
                        {w.smartMoneyScore ?? '—'}
                      </td>
                      <td className="text-[11px] font-mono px-2 py-1.5 text-right text-text-secondary hidden sm:table-cell tabular-nums">
                        {w.entityTvl ? formatUsd(w.entityTvl) : '—'}
                      </td>
                    </tr>
                  ))}
                  {tc.visible.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-[11px] font-mono text-text-muted">No wallets match the current filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      </div>
    </NexusLayout>
  )
}
