"use client"

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import {
  ArrowRight, BarChart3, Check, Globe2, Layers, Radio, Users, Zap,
} from 'lucide-react'

const STATS = [
  { value: '38,902', label: 'Instruments indexed' },
  { value: '20', label: 'Exchanges' },
  { value: '15', label: 'Markets' },
  { value: '58+', label: 'Data modules' },
  { value: '~3M', label: 'Queries/sec served' },
]

const FEATURES = [
  {
    icon: Layers,
    title: 'Bandarmology — IDX depth nobody else has',
    body: 'Foreign flow per stock, sector rotation, broker board, accumulation streaks — the Indonesian market decoded daily from exchange summaries.',
  },
  {
    icon: Globe2,
    title: '14 global markets, one screen',
    body: 'US, Japan, UK, Germany, Hong Kong, India, Canada, Korea, Taiwan, Australia, Singapore, Brazil, Switzerland, Netherlands — unified symbols, one search.',
  },
  {
    icon: BarChart3,
    title: 'Fundamentals that load instantly',
    body: 'PER, PBV, ROE, DER, EPS and market cap for the entire IDX universe — harvested nightly, served from memory in single-digit milliseconds.',
  },
  {
    icon: Zap,
    title: 'AI signals with real risk levels',
    body: 'Entry, TP1–TP3 and stop-loss computed from live volatility — cross-correlated across trade flow, whale alerts, funding and sentiment.',
  },
  {
    icon: Radio,
    title: 'On-chain intelligence',
    body: 'Whale alerts, DEX flows, stablecoin shifts, token unlocks and dev activity — the crypto layer wired into the same terminal.',
  },
  {
    icon: Users,
    title: 'Copy-trading leaderboard',
    body: 'Gate.io and Hyperliquid leaders ranked, with per-trader performance drill-downs — see what the best are actually doing.',
  },
]

const COMPARISON = [
  { name: 'NEXUS', price: 'Free', idx: true, global: true, onchain: true, bandar: true, api: true, highlight: true },
  { name: 'Bloomberg Terminal', price: '~$24k/yr', idx: true, global: true, onchain: false, bandar: false, api: true, highlight: false },
  { name: 'Hyperdash', price: 'Paid tiers', idx: false, global: false, onchain: true, bandar: false, api: false, highlight: false },
  { name: 'Stockbit', price: 'Freemium', idx: true, global: false, onchain: false, bandar: true, api: false, highlight: false },
]

const MARKETS = [
  ['United States', 5705], ['India', 7826], ['Japan', 3782], ['Canada', 4123],
  ['United Kingdom', 2735], ['Korea', 2739], ['Hong Kong', 2652], ['Taiwan', 2343],
  ['Germany', 822], ['Brazil', 781], ['Australia', 1619], ['Switzerland', 394],
  ['Singapore', 539], ['Netherlands', 104], ['Indonesia', 843],
]

function Mark() {
  return <span className="text-teal-vivid font-bold tracking-tight">◆ NEXUS</span>
}

export default function LandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = true
  }, [])
  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-bg-border/60 bg-bg-base/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-lg"><Mark /></Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-text-secondary">
            <a href="#features" className="hover:text-text-primary transition-colors">Features</a>
            <a href="#walkthrough" className="hover:text-text-primary transition-colors">Walkthrough</a>
            <a href="#coverage" className="hover:text-text-primary transition-colors">Coverage</a>
            <a href="#compare" className="hover:text-text-primary transition-colors">Compare</a>
            <Link href="/pricing" className="hover:text-text-primary transition-colors">Pricing</Link>
          </nav>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-teal-vivid text-bg-void text-sm font-semibold hover:bg-teal-vivid/85 transition-colors"
          >
            Open Terminal <ArrowRight size={15} />
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 60% 45% at 50% -5%, rgba(45,212,160,0.13), transparent 70%)',
          }}
        />
        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-bg-border bg-bg-panel text-xs text-text-secondary mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-vivid animate-live-dot" />
            Live — 38,902 instruments across 20 exchanges
          </div>
          <h1 className="text-[2.75rem] md:text-6xl font-bold tracking-tight leading-[1.05] mb-6">
            Market intelligence,
            <br />
            <span className="text-teal-vivid">Bloomberg-grade.</span> Zero cost.
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto mb-9 leading-relaxed">
            IDX bandarmology, fundamentals, 14 global markets, on-chain intel and AI signals —
            one terminal, every dataset served from memory in milliseconds.
          </p>
          <div className="flex items-center justify-center gap-3 mb-14">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-teal-vivid text-bg-void font-semibold hover:bg-teal-vivid/85 transition-colors"
            >
              Open Terminal <ArrowRight size={16} />
            </Link>
            <a
              href="#coverage"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-bg-border bg-bg-panel text-text-primary font-medium hover:border-border-active transition-colors"
            >
              Explore coverage
            </a>
          </div>

          {/* ── Product mock — real layout, real numbers ── */}
          <div className="max-w-4xl mx-auto rounded-xl border border-bg-border bg-bg-panel shadow-2xl shadow-black/50 overflow-hidden text-left">
            <div className="flex items-center gap-1.5 px-4 h-9 border-b border-bg-border bg-bg-raised/60">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
              <span className="ml-3 text-xs text-text-muted">◆ NEXUS — Intelligence Terminal</span>
            </div>
            <div className="grid grid-cols-12 text-xs">
              {/* mini sidebar */}
              <div className="col-span-3 md:col-span-2 border-r border-bg-border p-3 space-y-2 text-text-muted hidden sm:block">
                {['Dashboard', 'Equities', 'Bandarmology', 'AI Signals', 'On-Chain', 'Copy Trading'].map((s, i) => (
                  <div key={s} className={`px-2 py-1 rounded-md ${i === 2 ? 'bg-teal-dim/40 text-teal-vivid font-semibold' : ''}`}>{s}</div>
                ))}
              </div>
              {/* mini content */}
              <div className="col-span-9 md:col-span-10 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Bandarmology — IDX Foreign Flow</span>
                  <span className="text-text-muted text-xs">session 2026-08-24 · 843 stocks</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ['S&P 500', '6,677', '+0.04%'],
                    ['IHSG', '6,406', '-0.12%'],
                    ['NIKKEI', '45,833', '+1.47%'],
                    ['BTC', '$2,495M vol', '+2.55%'],
                  ].map(([n, v, c]) => (
                    <div key={n} className="rounded-lg border border-bg-border p-2.5 bg-bg-base">
                      <div className="text-xs text-text-muted">{n}</div>
                      <div className="text-sm font-semibold tabular-nums">{v}</div>
                      <div className={`text-xs tabular-nums ${c.startsWith('-') ? 'text-data-bear' : 'text-data-bull'}`}>{c}</div>
                    </div>
                  ))}
                </div>
                {/* foreign flow bars mock */}
                <div className="rounded-lg border border-bg-border p-3">
                  <div className="text-xs text-text-muted mb-2">Foreign net value / session — Rp B</div>
                  <div className="flex items-end gap-1 h-14">
                    {[38, 52, -30, 64, -22, 45, -70, 30, 55, -40, 62, 28, -48, 58, 35, -25, 70, 42, -55, 50].map((v, i) => (
                      <div key={i} className="flex-1 flex flex-col justify-end h-full">
                        <div
                          className={v >= 0 ? 'bg-data-bull/70 rounded-sm' : 'bg-data-bear/70 rounded-sm'}
                          style={{ height: `${Math.abs(v) * 0.9}%`, alignSelf: v >= 0 ? 'flex-end' : 'flex-start', marginTop: v >= 0 ? 'auto' : 0, marginBottom: v < 0 ? 'auto' : 0 }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {[
                    ['TINS', 'PT Timah Tbk', '+99.09', 'text-data-bull'],
                    ['BRMS', 'Bumi Resources Minerals', '+56.33', 'text-data-bull'],
                    ['BBRI', 'Bank Rakyat Indonesia', '-21.81', 'text-data-bear'],
                  ].map(([c, n, v, cls]) => (
                    <div key={c} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-bg-raised/60">
                      <span className="font-semibold text-teal-vivid w-14">{c}</span>
                      <span className="text-text-muted flex-1 truncate">{n}</span>
                      <span className={`tabular-nums ${cls}`}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ── */}
      <section className="border-y border-bg-border bg-bg-panel/50">
        <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-bold tabular-nums tracking-tight">{s.value}</div>
              <div className="text-xs text-text-muted mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <p className="eyebrow mb-2">Capabilities</p>
        <h2 className="text-3xl font-bold tracking-tight mb-3">Everything the expensive terminals have. Then some.</h2>
        <p className="text-text-secondary mb-10 max-w-2xl">
          Six intelligence layers, one keyboard-driven terminal — built for traders who want the data without the enterprise invoice.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card card-hover p-5">
              <f.icon size={20} className="text-teal-vivid mb-3" />
              <h3 className="font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Walkthrough ── */}
      <section id="walkthrough" className="max-w-6xl mx-auto px-6 py-20">
        <p className="eyebrow mb-2">Walkthrough</p>
        <h2 className="text-3xl font-bold tracking-tight mb-3">See NEXUS in 60 seconds.</h2>
        <p className="text-text-secondary mb-8 max-w-2xl">
          A quick tour of the terminal — IDX bandarmology, global universes, on-chain intel, and AI signals, all from one keyboard-driven workspace.
        </p>
        <div className="card overflow-hidden bg-bg-base">
          <video
            ref={videoRef}
            className="w-full aspect-video object-cover"
            src="/videos/nexus-walkthrough.mp4"
            poster="/videos/nexus-walkthrough-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
          />
        </div>
      </section>

      {/* ── Coverage ── */}
      <section id="coverage" className="border-y border-bg-border bg-bg-panel/40">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <p className="eyebrow mb-2">Coverage</p>
          <h2 className="text-3xl font-bold tracking-tight mb-3">15 markets. One symbol namespace.</h2>
          <p className="text-text-secondary mb-8 max-w-2xl">
            Every listing unified with Yahoo-compatible suffixes — search once, chart anywhere.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {MARKETS.map(([name, count]) => (
              <div key={name} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-bg-border bg-bg-panel text-sm card-hover">
                <span>{name}</span>
                <span className="text-text-muted tabular-nums">{(count as number).toLocaleString('en-US')}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison ── */}
      <section id="compare" className="max-w-6xl mx-auto px-6 py-20">
        <p className="eyebrow mb-2">Compare</p>
        <h2 className="text-3xl font-bold tracking-tight mb-8">The invoice is the feature</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bg-border text-text-muted">
                <th className="text-left px-5 py-3.5 font-medium">Terminal</th>
                <th className="text-right px-5 py-3.5 font-medium">Price</th>
                <th className="px-4 py-3.5 font-medium text-center">IDX depth</th>
                <th className="px-4 py-3.5 font-medium text-center">Global</th>
                <th className="px-4 py-3.5 font-medium text-center">On-chain</th>
                <th className="px-4 py-3.5 font-medium text-center">API</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((r) => (
                <tr key={r.name} className={`border-b border-bg-border/60 ${r.highlight ? 'bg-teal-dim/20' : ''}`}>
                  <td className="px-5 py-3.5 font-semibold">
                    {r.name}
                    {r.highlight && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-teal-vivid text-bg-void text-xs font-bold align-middle">FREE</span>
                    )}
                  </td>
                  <td className={`px-5 py-3.5 text-right tabular-nums ${r.highlight ? 'text-teal-vivid font-semibold' : 'text-text-secondary'}`}>{r.price}</td>
                  {[r.bandar, r.global, r.onchain, r.api].map((v, i) => (
                    <td key={i} className="px-4 py-3.5 text-center">
                      {v ? <Check size={16} className="inline text-teal-vivid" /> : <span className="text-text-muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted mt-3">
          Competitor positioning as of Aug 2026 — Bloomberg Terminal list price, Hyperdash crypto-only scope, Stockbit IDX-focused freemium.
        </p>
      </section>

      {/* ── CTA ── */}
      <section className="relative overflow-hidden border-t border-bg-border">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 55% 60% at 50% 110%, rgba(45,212,160,0.12), transparent 70%)' }}
        />
        <div className="relative max-w-3xl mx-auto px-6 py-24 text-center">
          <h2 className="text-4xl font-bold tracking-tight mb-4">Stop paying for less data.</h2>
          <p className="text-text-secondary text-lg mb-8">
            Open the terminal — no signup, no API keys, no credit card. Everything above is live right now.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-lg bg-teal-vivid text-bg-void font-semibold text-lg hover:bg-teal-vivid/85 transition-colors"
          >
            Open Terminal <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-bg-border bg-bg-panel/40">
        <div className="max-w-6xl mx-auto px-6 py-12 grid md:grid-cols-4 gap-8 text-sm">
          <div>
            <div className="text-lg mb-2"><Mark /></div>
            <p className="text-text-muted text-xs leading-relaxed">
              Market intelligence terminal — IDX bandarmology, global universes, on-chain intel and AI signals.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-3">Product</p>
            <ul className="space-y-2 text-text-secondary">
              <li><Link href="/dashboard" className="hover:text-text-primary">Terminal</Link></li>
              <li><Link href="/equities" className="hover:text-text-primary">Equities</Link></li>
              <li><Link href="/bandarmology" className="hover:text-text-primary">Bandarmology</Link></li>
              <li><Link href="/screener" className="hover:text-text-primary">Screener</Link></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-3">Resources</p>
            <ul className="space-y-2 text-text-secondary">
              <li><Link href="/api-docs" className="hover:text-text-primary">API Docs</Link></li>
              <li><Link href="/pricing" className="hover:text-text-primary">Pricing</Link></li>
              <li><Link href="/terms" className="hover:text-text-primary">Terms</Link></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-3">Data</p>
            <ul className="space-y-2 text-text-secondary text-xs">
              <li>TradingView · idx.co.id · Stockbit RE</li>
              <li>Binance · Gate.io · Hyperliquid</li>
              <li>Yahoo Finance · FRED · World Bank</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-bg-border/60">
          <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-text-muted flex flex-col md:flex-row justify-between gap-2">
            <span>© 2026 NEXUS — BerkahKarya. Data for research; not financial advice.</span>
            <span>Datasets refresh nightly · served from memory</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
