'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Search, X, ArrowRight, Building2, Coins, TrendingUp, Users, Loader } from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/config/nav'
import { INDICES, GLOBAL_STOCKS, ALL_COMMODITIES, CRYPTO_TAB_SYMBOLS } from '@/lib/config/universe'

interface SearchResult {
  id: string
  label: string
  sublabel?: string
  description?: string
  href: string
  section: 'Pages' | 'Assets' | 'Profiles'
  icon: React.ReactNode
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [leaders, setLeaders] = useState<SearchResult[]>([])
  const [leadersLoading, setLeadersLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const pathname = usePathname()

  // Fetch copy-trading leaders when opened
  async function fetchLeaders() {
    setLeadersLoading(true)
    try {
      const res = await fetch('/api/v1/copy-trading/leaderboard?limit=20')
      const json = await res.json()
      const data = json?.data ?? json
      const list = data?.leaders ?? []
      setLeaders(list.map((l: Record<string, unknown>) => ({
        id: `leader-${l.id}`,
        label: String(l.nick ?? l.id ?? ''),
        sublabel: `${l.platform} · ${l.profit ? '$' + Number(l.profit).toLocaleString() : ''}`,
        href: `/copy-trading/leader/${l.id}?platform=${l.platform}`,
        section: 'Profiles' as const,
        icon: <Users size={14} />,
      })))
    } catch { /* ignore */ }
    setLeadersLoading(false)
  }


  // Close on route change (adjust state during render — React-recommended reset pattern)
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setOpen(false)
  }

  // Cmd+K / Ctrl+K to open, Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
        fetchLeaders()
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Build static index (pages + assets)
  const staticIndex = useMemo(() => {
    const items: SearchResult[] = []

    // Pages
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        items.push({
          id: `page-${item.href}`,
          label: item.label,
          description: item.description,
          href: item.href,
          section: 'Pages' as const,
          icon: <item.icon size={14} />,
        })
      }
    }

    // Indices
    for (const idx of INDICES) {
      items.push({
        id: `idx-${idx.symbol}`,
        label: idx.name,
        sublabel: idx.symbol,
        href: `/charts?symbol=${idx.symbol}`,
        section: 'Assets' as const,
        icon: <TrendingUp size={14} />,
      })
    }

    // Stocks
    for (const s of GLOBAL_STOCKS) {
      items.push({
        id: `stock-${s.symbol}`,
        label: s.name,
        sublabel: `${s.symbol} · ${s.sector ?? ''}`,
        href: `/charts?symbol=${s.symbol}`,
        section: 'Assets' as const,
        icon: <Building2 size={14} />,
      })
    }

    // Commodities
    for (const c of ALL_COMMODITIES) {
      items.push({
        id: `comm-${c.symbol}`,
        label: c.name,
        sublabel: c.symbol,
        href: `/charts?symbol=${c.symbol}`,
        section: 'Assets' as const,
        icon: <Coins size={14} />,
      })
    }

    // Crypto
    for (const sym of CRYPTO_TAB_SYMBOLS) {
      items.push({
        id: `crypto-${sym}`,
        label: sym,
        sublabel: 'Crypto',
        href: `/charts?symbol=${sym}`,
        section: 'Assets' as const,
        icon: <Coins size={14} />,
      })
    }

    return items
  }, [])

  // Fuzzy filter
  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    const scored: Array<SearchResult & { score: number }> = []

    const addMatches = (items: SearchResult[]) => {
      for (const item of items) {
        const label = item.label.toLowerCase()
        const sub = (item.sublabel ?? '').toLowerCase()
        const desc = (item.description ?? '').toLowerCase()

        let score = -1
        if (label === q) score = 100
        else if (label.startsWith(q)) score = 80
        else if (label.includes(q)) score = 60
        else if (sub.startsWith(q)) score = 50
        else if (sub.includes(q)) score = 40
        else if (desc.includes(q)) score = 30

        if (score > 0) scored.push({ ...item, score })
      }
    }

    addMatches(staticIndex)
    addMatches(leaders)

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 30)
  }, [query, staticIndex, leaders])

  // Clamp active index to results (derived from state — no effect needed)
  const effectiveIdx = results.length > 0 ? Math.min(activeIdx, results.length - 1) : 0

  const select = useCallback((result: SearchResult) => {
    setOpen(false)
    setQuery('')
    router.push(result.href)
  }, [router])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(Math.min(effectiveIdx + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(Math.max(effectiveIdx - 1, 0))
    } else if (e.key === 'Enter' && results[effectiveIdx]) {
      select(results[effectiveIdx])
    }
  }, [results, effectiveIdx, select])

  if (!open) return null

  // Group sections
  const sections: { title: string; items: SearchResult[] }[] = []
  const seen = new Set<string>()
  for (const r of results) {
    if (!seen.has(r.section)) {
      seen.add(r.section)
      sections.push({ title: r.section, items: [] })
    }
    sections[sections.length - 1].items.push(r)
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-start justify-center"
      onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="w-full max-w-xl mt-[15vh] mx-4 bg-bg-panel border border-bg-border rounded-xl shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-bg-border">
          <Search size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, assets, profiles…"
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-text-muted hover:text-text-secondary">
              <X size={14} />
            </button>
          )}
          <kbd className="text-[10px] text-text-muted bg-bg-base px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {!query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              Type to search pages, assets, or profiles
            </div>
          )}
          {query.trim() && results.length === 0 && !leadersLoading && (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              No results for &quot;{query}&quot;
            </div>
          )}
          {leadersLoading && query.trim().length > 0 && (
            <div className="px-4 py-2 text-xs text-text-muted flex items-center gap-2">
              <Loader size={12} className="animate-spin" /> Loading profiles…
            </div>
          )}
          {sections.map(section => (
            <div key={section.title}>
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {section.title}
              </div>
              {section.items.map((item, _i) => {
                const globalIdx = results.findIndex(r => r.id === item.id)
                return (
                  <button
                    key={item.id}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                      globalIdx === effectiveIdx
                        ? 'bg-teal-dim/30 text-text-primary'
                        : 'text-text-secondary hover:bg-bg-raised'
                    }`}
                    onMouseDown={() => select(item)}
                    onMouseEnter={() => setActiveIdx(globalIdx)}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      <div className="text-xs text-text-muted truncate">{item.sublabel ?? item.description}</div>
                    </div>
                    <ArrowRight size={12} className="shrink-0 text-text-muted opacity-0 group-hover:opacity-100" />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}