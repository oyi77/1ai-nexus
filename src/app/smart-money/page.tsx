"use client"

import { TerminalShell } from "@/components/layout/TerminalShell"

export default function SmartMoneyPage() {
  return (
    <TerminalShell>
      <div className="p-6 space-y-6">
        <h1 className="text-xl font-bold font-mono text-accent-cyan">SMART MONEY TRACKER</h1>

        {/* Smart Money Flow Board */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-3">SMART MONEY FLOW — 24H</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {['VC Funds', 'CEX Hot Wallets', 'Known Whales', 'DeFi Protocols', 'DEX Traders'].map(cat => (
              <div key={cat} className="bg-bg-elevated rounded p-3">
                <p className="text-[10px] text-text-muted uppercase">{cat}</p>
                <p className="text-lg font-mono font-bold text-text-primary">—</p>
                <p className="text-[10px] text-text-dim">net buy/sell</p>
              </div>
            ))}
          </div>
        </div>

        {/* Wallet Profiler */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-3">WALLET PROFILER</h2>
          <p className="text-xs text-text-dim">
            Enter a wallet address to view entity label, PnL timeline, holdings breakdown, and activity heatmap.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder="0x... or .sol address"
              className="flex-1 bg-bg-deep border border-border-dim rounded px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
            />
            <button className="px-4 py-2 bg-accent-cyan/20 text-accent-cyan text-xs font-mono rounded border border-accent-cyan/30 hover:bg-accent-cyan/30 transition-colors">
              ANALYZE
            </button>
          </div>
        </div>

        {/* Smart Money Scores */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-3">TOP SMART MONEY WALLETS</h2>
          <p className="text-xs text-text-dim">
            Data from NEXUS Smart Money Engine (derived) — combines wallet age, on-chain PnL, DEX trade patterns, and entity labels.
          </p>
          <div className="mt-3 text-text-muted text-xs">
            Wallet data will populate as the indexer processes on-chain transactions.
          </div>
        </div>
      </div>
    </TerminalShell>
  )
}
