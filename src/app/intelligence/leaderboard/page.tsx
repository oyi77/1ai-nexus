'use client'

import { useEffect, useState } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { Trophy, TrendingUp, TrendingDown, Minus, Target } from 'lucide-react'

interface Bucket {
  label: string
  signals: number
  evaluated: number
  winRate: number
}

interface AccuracyData {
  total: number
  evaluated: number
  overallWinRate: number
  buckets: Bucket[]
}

function winRateColor(rate: number): string {
  if (rate >= 70) return 'text-data-bull'
  if (rate >= 50) return 'text-amber-400'
  return 'text-data-bear'
}

function winRateBar(rate: number): string {
  if (rate >= 70) return 'bg-data-bull'
  if (rate >= 50) return 'bg-amber-400'
  return 'bg-data-bear'
}

export default function ConvictionLeaderboardPage() {
  const [data, setData] = useState<AccuracyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/conviction/accuracy')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <NexusLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Trophy className="w-6 h-6 text-amber-400" />
          <h1 className="text-2xl font-bold text-white">Conviction Leaderboard</h1>
        </div>
        <p className="text-zinc-400">
          Proof that conviction scores predict price moves. Every BUY/SELL emission is tracked
          and evaluated after 24h. The higher the conviction, the higher the win-rate should be.
        </p>

        {loading && (
          <div className="text-zinc-400 text-center py-12">Loading accuracy data...</div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Overall stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="text-sm text-zinc-400 mb-1">Total Signals</div>
                <div className="text-3xl font-bold text-white">{data.total}</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="text-sm text-zinc-400 mb-1">Evaluated</div>
                <div className="text-3xl font-bold text-white">{data.evaluated}</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="text-sm text-zinc-400 mb-1">Overall Win Rate</div>
                <div className={`text-3xl font-bold ${winRateColor(data.overallWinRate)}`}>
                  {data.overallWinRate.toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Buckets */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Target className="w-5 h-5" />
                Win Rate by Conviction Bucket
              </h2>
              <div className="space-y-4">
                {data.buckets.map(bucket => (
                  <div key={bucket.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-zinc-300">
                        Conviction {bucket.label}
                      </span>
                      <span className={`text-sm font-medium ${winRateColor(bucket.winRate)}`}>
                        {bucket.winRate.toFixed(1)}% ({bucket.evaluated} signals)
                      </span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${winRateBar(bucket.winRate)}`}
                        style={{ width: `${Math.min(bucket.winRate, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {data.evaluated === 0 && (
                <p className="text-zinc-500 text-sm mt-4 text-center">
                  No signals have matured yet. Conviction signals are evaluated 24h after emission.
                </p>
              )}
            </div>

            {/* Trust note */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-medium text-zinc-300 mb-2">How this works</h3>
              <ul className="text-sm text-zinc-500 space-y-1">
                <li>• Every BUY/SELL conviction emission is persisted to the database</li>
                <li>• After 24h, the price is measured and classified as win (+0.5%) or loss</li>
                <li>• WAIT signals are not tracked — they represent indecision, not conviction</li>
                <li>• The higher the conviction score, the higher the expected win-rate</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </NexusLayout>
  )
}
