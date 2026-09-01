import { Metadata } from 'next'
import { Panel } from '@/components/shell/Panel'
import { TrendingUp, BarChart3, Target, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────
interface ConvictionReason {
  text: string
  weight: number
}

interface ConvictionItem {
  symbol: string
  name: string
  price: number
  changePct: number
  conviction: number
  action: 'BUY' | 'WAIT' | 'SELL'
  direction: 'bull' | 'bear' | 'neutral'
  reasons: ConvictionReason[]
  sources: string[]
}

interface ConvictionMarket {
  id: string
  label: string
  items: ConvictionItem[]
}

interface ConvictionResult {
  generated: string
  markets: ConvictionMarket[]
}

interface AccuracyBucket {
  label: string
  signals: number
  evaluated: number
  winRate: number
}

interface AccuracyData {
  total: number
  evaluated: number
  overallWinRate: number
  buckets: AccuracyBucket[]
}

// ── SEO metadata ─────────────────────────────────────────────────
export const metadata: Metadata = {
  title: 'Market Intelligence — Daily Conviction Signals | NEXUS',
  description:
    'Free daily conviction signals for IDX stocks and crypto. AI-scored BUY/WAIT/SELL ratings, win-rate track record, and market intelligence — updated every 30 seconds.',
  openGraph: {
    title: 'Market Intelligence — Daily Conviction Signals | NEXUS',
    description:
      'AI-scored conviction signals for IDX and crypto. Track record: win-rate by score bucket. Free, updated every 30s.',
    url: 'https://tracker.aitradepulse.com/insights',
    siteName: 'NEXUS',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Market Intelligence — Daily Conviction Signals',
    description: 'Free AI conviction signals for IDX and crypto. Win-rate track record. Updated every 30s.',
  },
  alternates: {
    canonical: 'https://tracker.aitradepulse.com/insights',
  },
}

// ── Data fetch (server-side, cached) ─────────────────────────────
const BASE = 'https://tracker.aitradepulse.com'

async function fetchConviction(): Promise<ConvictionResult | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/conviction`, {
      next: { revalidate: 30 },
    })
    if (!res.ok) return null
    const json = await res.json()
    return json?.data ?? json ?? null
  } catch {
    return null
  }
}

async function fetchAccuracy(): Promise<AccuracyData | null> {
  try {
    const res = await fetch(`${BASE}/api/v1/conviction/accuracy`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    const json = await res.json()
    return json?.data ?? json ?? null
  } catch {
    return null
  }
}

// ── Helpers ──────────────────────────────────────────────────────
function barColor(conviction: number): string {
  if (conviction >= 65) return 'bg-data-bull'
  if (conviction < 35) return 'bg-data-bear'
  return 'bg-amber-500'
}

function actionBadge(action: string): { color: string; icon: typeof ArrowUpRight } {
  if (action === 'BUY') return { color: 'bg-data-bull/20 text-data-bull border-data-bull/30', icon: ArrowUpRight }
  if (action === 'SELL') return { color: 'bg-data-bear/20 text-data-bear border-data-bear/30', icon: ArrowDownRight }
  return { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: Minus }
}

function weightDots(weight: number): number {
  if (weight > 0.3) return 3
  if (weight > 0.2) return 2
  return 1
}

// ── Components ───────────────────────────────────────────────────
function SignalCard({ item }: { item: ConvictionItem }) {
  const badge = actionBadge(item.action)
  const Icon = badge.icon
  return (
    <article className="bg-bg-raised border border-bg-border p-4 rounded-lg">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-text-primary font-semibold text-lg font-mono truncate">{item.symbol}</h3>
          <p className="text-text-muted text-sm truncate">{item.name}</p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${badge.color} shrink-0`}>
          <Icon size={12} />
          {item.action}
        </span>
      </div>

      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-text-secondary text-sm">Conviction</span>
          <span className="text-text-primary font-mono font-bold text-lg">{item.conviction.toFixed(1)}</span>
        </div>
        <div className="w-full h-2 bg-bg-base rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor(item.conviction)}`}
            style={{ width: `${Math.min(100, item.conviction)}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm mb-3">
        <span className="text-text-muted font-mono">${item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span className={`font-mono font-medium ${item.changePct >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
          {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
        </span>
      </div>

      <div>
        <p className="text-text-muted text-xs uppercase tracking-wide mb-1.5">Key Drivers</p>
        <ul className="space-y-1">
          {item.reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-text-secondary">
              <span className="flex gap-0.5 shrink-0">
                {Array.from({ length: weightDots(r.weight) }).map((_, j) => (
                  <span key={j} className="w-1.5 h-1.5 rounded-full bg-teal-vivid" />
                ))}
              </span>
              <span className="truncate">{r.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

function TrackRecordPanel({ accuracy }: { accuracy: AccuracyData | null }) {
  return (
    <Panel title="Track Record" subtitle="Win-rate by conviction bucket" className="h-full">
      <div className="p-4">
        {!accuracy || accuracy.buckets.length === 0 ? (
          <p className="text-text-muted text-sm">Track record accumulates as signals mature (24h horizon). Check back soon.</p>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-2 mb-4">
              {accuracy.buckets.map((b) => (
                <div key={b.label} className="text-center">
                  <p className="text-[10px] font-mono text-text-muted uppercase tracking-wide">Conv {b.label}</p>
                  <p className={`text-lg font-bold font-mono ${b.winRate >= 65 ? 'text-data-bull' : b.winRate >= 45 ? 'text-amber-400' : 'text-data-bear'}`}>
                    {b.winRate.toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-text-muted">{b.evaluated} signals</p>
                </div>
              ))}
            </div>
            <div className="border-t border-bg-border pt-3 flex items-center justify-between">
              <span className="text-text-muted text-sm">Overall win-rate</span>
              <span className="text-text-primary font-mono font-bold">{accuracy.overallWinRate.toFixed(1)}%</span>
            </div>
            <p className="text-text-muted text-xs mt-2">
              {accuracy.total} total signals · {accuracy.evaluated} evaluated (24h horizon)
            </p>
          </>
        )}
      </div>
    </Panel>
  )
}

// ── Page ─────────────────────────────────────────────────────────
export default async function InsightsPage() {
  const [conviction, accuracy] = await Promise.all([fetchConviction(), fetchAccuracy()])

  const allItems = conviction?.markets?.flatMap((m) => m.items) ?? []
  const buySignals = allItems.filter((i) => i.action === 'BUY').sort((a, b) => b.conviction - a.conviction)
  const sellSignals = allItems.filter((i) => i.action === 'SELL').sort((a, b) => a.conviction - b.conviction)
  const generatedAt = conviction?.generated ? new Date(conviction.generated).toLocaleString() : null

  return (
    <main className="min-h-screen bg-bg-base">
      {/* Hero */}
      <header className="border-b border-bg-border bg-bg-panel">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={20} className="text-teal-vivid" />
            <span className="text-text-muted text-sm font-mono uppercase tracking-wide">Market Intelligence</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">
            Daily Conviction Signals
          </h1>
          <p className="text-text-secondary max-w-2xl text-base sm:text-lg">
            AI-scored BUY / WAIT / SELL ratings for IDX stocks and crypto. Every symbol analyzed across
            technicals, on-chain, and market structure — updated every 30 seconds.
          </p>
          {generatedAt && (
            <p className="text-text-muted text-sm mt-3 font-mono">
              Last updated: {generatedAt}
            </p>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
        {/* Top BUY signals */}
        <section aria-labelledby="buy-heading">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-data-bull" />
            <h2 id="buy-heading" className="text-xl font-semibold text-text-primary">
              Top BUY Signals
            </h2>
            <span className="text-text-muted text-sm font-mono">{buySignals.length} signals</span>
          </div>
          {buySignals.length === 0 ? (
            <p className="text-text-muted">No high-conviction BUY signals right now. Markets are consolidating.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {buySignals.slice(0, 6).map((item) => (
                <SignalCard key={`${item.symbol}-${item.action}`} item={item} />
              ))}
            </div>
          )}
        </section>

        {/* Top SELL signals */}
        <section aria-labelledby="sell-heading">
          <div className="flex items-center gap-2 mb-4">
            <ArrowDownRight size={18} className="text-data-bear" />
            <h2 id="sell-heading" className="text-xl font-semibold text-text-primary">
              Top SELL Signals
            </h2>
            <span className="text-text-muted text-sm font-mono">{sellSignals.length} signals</span>
          </div>
          {sellSignals.length === 0 ? (
            <p className="text-text-muted">No active SELL signals. No assets showing strong bearish conviction.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sellSignals.slice(0, 6).map((item) => (
                <SignalCard key={`${item.symbol}-${item.action}`} item={item} />
              ))}
            </div>
          )}
        </section>

        {/* Track Record */}
        <section aria-labelledby="track-heading">
          <div className="flex items-center gap-2 mb-4">
            <Target size={18} className="text-teal-vivid" />
            <h2 id="track-heading" className="text-xl font-semibold text-text-primary">
              Track Record
            </h2>
          </div>
          <p className="text-text-secondary mb-4 max-w-2xl">
            Does high conviction actually win? We measure every signal against price 24 hours later.
            The higher the conviction, the higher the hit-rate should be.
          </p>
          <TrackRecordPanel accuracy={accuracy} />
        </section>

        {/* Telegram CTA */}
        <section className="bg-bg-panel border border-bg-border rounded-lg p-6 sm:p-8 text-center">
          <h2 className="text-lg font-semibold text-text-primary mb-2">Get daily signals on Telegram</h2>
          <p className="text-text-secondary mb-4 max-w-md mx-auto">
            Free daily broadcast of top conviction signals. No spam, unsubscribe anytime.
          </p>
          <a
            href="https://t.me/NexusTrackerBot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-vivid text-bg-base font-semibold rounded-lg hover:opacity-90 transition-opacity"
          >
            Subscribe on Telegram
            <ArrowUpRight size={16} />
          </a>
        </section>
      </div>
    </main>
  )
}
