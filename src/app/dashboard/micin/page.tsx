'use client'
import { useEffect, useState } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { Panel } from "@/components/shell/Panel"

interface WhaleMove {
  token: string
  symbol: string
  totalUsd: number
  netDirection: "buy" | "sell" | "mixed"
  buyerCount: number
  sellerCount: number
}
interface SmartSignal {
  symbol: string
  action: "buy" | "sell" | "hold"
  confidence: number
  reason: string
}

export default function MicinPage() {
  const [whaleMoves, setWhaleMoves] = useState<WhaleMove[]>([])
  const [signals, setSignals] = useState<SmartSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [wallet, setWallet] = useState('')
  const [mint, setMint] = useState('')
  const [marketCapUsd, setMarketCapUsd] = useState('')
  const [entryPrice, setEntryPrice] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [wRes, sRes] = await Promise.all([
          fetch('/api/v1/whale-alert?limit=10').then(r => r.json()).catch(() => ({ data: [] })),
          fetch('/api/v1/signals?limit=10').then(r => r.json()).catch(() => ({ data: [] })),
        ])
        if (!active) return
        const wArr = Array.isArray(wRes?.data ?? wRes) ? (wRes?.data ?? wRes) : []
        const sArr = Array.isArray(sRes?.data ?? sRes) ? (sRes?.data ?? sRes) : []
        setWhaleMoves(wArr.slice(0, 10))
        setSignals(sArr.slice(0, 10))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  const handleWalletSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mint.trim() || !wallet.trim() || !entryPrice.trim()) {
      setStatus('Required: wallet, mint, and entryPrice.')
      return
    }
    setStatus('Registering watch position...')
    try {
      const res = await fetch('/api/v1/micin/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'default',
          walletAddress: wallet.trim(),
          mint: mint.trim(),
          entryPrice: Number(entryPrice) || 0,
          targetPrice: Number(targetPrice) || null,
          stopLoss: Number(stopLoss) || null,
          marketCapUsd: Number(marketCapUsd) || 0,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>))
        setStatus(String(data.error ?? `HTTP ${res.status}`))
        return
      }
      setStatus('Watch registered. AI will alert on TP/SL.')
      setMarketCapUsd('')
      setMint('')
      setMarketCapUsd('')
      setEntryPrice('')
      setTargetPrice('')
      setStopLoss('')
    } catch (err) {
      setStatus(`Network error: ${String(err)}`)
    }
  }

  return (
    <NexusLayout>
      <main className="flex flex-col gap-6 p-4 md:p-6 max-w-6xl mx-auto w-full">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">MICIN Intelligence</h1>
            <p className="text-sm text-slate-400 mt-1">Whale Tracking · Smart Money · Auto TP/SL Alerts</p>
          </div>
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        </header>

        <Panel title="Whale Moves" subtitle="High-conviction accumulation detected">
          {loading ? (
            <p className="text-slate-400 text-sm">Loading...</p>
          ) : whaleMoves.length === 0 ? (
            <p className="text-slate-400 text-sm">No whale activity yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {whaleMoves.map((w, i) => (
                  <tr key={i}>
                    <td className="py-2 font-mono text-xs">{w.symbol || w.token}</td>
                    <td className="py-2 text-right font-mono">${Math.round(w.totalUsd).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Smart Signals" subtitle="Directional bias from verified smart money">
          {loading ? (
            <p className="text-slate-400 text-sm">Loading...</p>
          ) : signals.length === 0 ? (
            <p className="text-slate-400 text-sm">No signals generated yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {signals.map((s, i) => (
                  <tr key={i}>
                    <td className="py-2 font-mono text-xs">{s.symbol}</td>
                    <td className="py-2 text-xs">{s.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Auto TP/SL Alert" subtitle="Non-custodial monitoring">
          <form onSubmit={handleWalletSubmit} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="Solana Wallet Address..."
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200"
              />
              <input
                type="text"
                value={mint}
                onChange={(e) => setMint(e.target.value)}
                placeholder="Token Mint Address..."
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="number"
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="Entry Price"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200"
              />
              <input
                type="number"
                step="any"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="Target Price (TP)"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200"
              />
              <input
                type="number"
                step="any"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="Stop Loss (SL)"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200"
              />
            </div>
            <input
              type="number"
              value={marketCapUsd}
              onChange={(e) => setMarketCapUsd(e.target.value)}
              placeholder="Approx Market Cap (USD)"
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-200"
            />
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 rounded-md transition-colors"
            >
              Activate Alerts
            </button>
            {status && (
              <p className="text-xs font-mono text-center mt-1 {status.includes('registered') ? 'text-emerald-400' : 'text-error' }">
                {status}
              </p>
            )}
          </form>
        </Panel>
      </main>
    </NexusLayout>
  )
}
