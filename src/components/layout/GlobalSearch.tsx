'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  Search, X, ArrowRight, Building2, Coins, TrendingUp, Users,
  Terminal, Globe, CornerDownLeft,
} from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/config/nav'
import { INDICES, GLOBAL_STOCKS, ALL_COMMODITIES, CRYPTO_TAB_SYMBOLS } from '@/lib/config/universe'
import { getAllCommands, parseCommand } from '@/lib/command/parser'

export interface SearchResult {
  id: string
  label: string
  sublabel?: string
  description?: string
  href: string
  section: 'Commands' | 'Quick Jumps' | 'Pages' | 'Assets' | 'Profiles'
  icon: React.ReactNode
  badge?: string
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [leaders, setLeaders] = useState<SearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const pathname = usePathname()

  // Fetch copy-trading leaders when opened
  const fetchLeaders = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/copy-trading/leaderboard?limit=20')
      const json = await res.json()
      const data = json?.data ?? json
      const list = data?.leaders ?? []
      setLeaders(
        list.map((l: Record<string, unknown>) => ({
          id: `leader-${l.id}`,
          label: String(l.nick ?? l.id ?? ''),
          sublabel: `${l.platform} · ${l.profit ? '$' + Number(l.profit).toLocaleString() : ''}`,
          description: `Copy-trading strategy leader on ${l.platform}`,
          href: `/copy-trading/leader/${l.id}?platform=${l.platform}`,
          section: 'Profiles' as const,
          icon: <Users size={14} className="text-indigo-400" />,
        })),
      )
    } catch {
      /* ignore */
    }
  }, [])

  // Close on route change
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setOpen(false)
  }

  // Keyboard and CustomEvent listener
  useEffect(() => {
    const handleOpen = () => {
      setOpen(true)
      void fetchLeaders()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => {
          if (!prev) void fetchLeaders()
          return !prev
        })
      } else if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault()
        handleOpen()
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('nexus:open-search', handleOpen)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('nexus:open-search', handleOpen)
    }
  }, [fetchLeaders])

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 40)
      return () => clearTimeout(t)
    }
  }, [open])

  // Static index: Pages + Universe Assets + Commands
  const { allItems, quickJumps, commandItems } = useMemo(() => {
    const pages: SearchResult[] = []
    const quick: SearchResult[] = []

    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        const resultItem: SearchResult = {
          id: `page-${item.href}`,
          label: item.label,
          sublabel: section.title,
          description: item.description,
          href: item.href,
          section: 'Pages',
          icon: <item.icon size={14} className="text-teal-vivid" />,
          badge: item.badge,
        }
        pages.push(resultItem)
        if (item.isPrimary) {
          quick.push({
            ...resultItem,
            id: `quick-${item.href}`,
            section: 'Quick Jumps',
          })
        }
      }
    }

    const assets: SearchResult[] = []

    for (const idx of INDICES) {
      assets.push({
        id: `idx-${idx.symbol}`,
        label: idx.name,
        sublabel: idx.symbol,
        description: `Index tracking ${idx.name}`,
        href: `/charts?symbol=${idx.symbol}`,
        section: 'Assets',
        icon: <TrendingUp size={14} className="text-emerald-400" />,
        badge: 'IDX',
      })
    }

    for (const s of GLOBAL_STOCKS) {
      assets.push({
        id: `stock-${s.symbol}`,
        label: s.name,
        sublabel: `${s.symbol} · ${s.sector ?? 'Stock'}`,
        description: `Equity instrument for ${s.name}`,
        href: `/charts?symbol=${s.symbol}`,
        section: 'Assets',
        icon: <Building2 size={14} className="text-blue-400" />,
        badge: 'EQUITY',
      })
    }

    for (const c of ALL_COMMODITIES) {
      assets.push({
        id: `comm-${c.symbol}`,
        label: c.name,
        sublabel: c.symbol,
        description: `Commodity market for ${c.name}`,
        href: `/charts?symbol=${c.symbol}`,
        section: 'Assets',
        icon: <Coins size={14} className="text-amber-400" />,
        badge: 'COMMODITY',
      })
    }

    for (const sym of CRYPTO_TAB_SYMBOLS) {
      assets.push({
        id: `crypto-${sym}`,
        label: sym,
        sublabel: 'Crypto',
        description: `Cryptocurrency asset ${sym}`,
        href: `/charts?symbol=${sym}`,
        section: 'Assets',
        icon: <Coins size={14} className="text-purple-400" />,
        badge: 'CRYPTO',
      })
    }

    const cmds: SearchResult[] = []
    const registered = getAllCommands()
    for (const cmd of registered) {
      cmds.push({
        id: `cmd-${cmd.verb}`,
        label: cmd.verb,
        sublabel: cmd.domain,
        description: cmd.description,
        href: cmd.handler('', []),
        section: 'Commands',
        icon: <Terminal size={14} className="text-teal-400" />,
        badge: 'CMD',
      })
    }

    return {
      allItems: [...pages, ...assets, ...cmds],
      quickJumps: quick.slice(0, 10),
      commandItems: cmds.slice(0, 8),
    }
  }, [])

  // Dynamic filter or initial zero-query suggestions
  const results = useMemo(() => {
    if (!query.trim()) {
      return [...quickJumps, ...commandItems]
    }

    const q = query.trim().toLowerCase()

    // Check if query is a direct command execution
    const parsed = parseCommand(query)
    const directCmd: SearchResult[] = []
    if (parsed.route && !parsed.error) {
      directCmd.push({
        id: `exec-${query}`,
        label: query.toUpperCase(),
        sublabel: 'Execute Command',
        description: `Direct jump to ${parsed.route}`,
        href: parsed.route,
        section: 'Commands',
        icon: <Terminal size={14} className="text-teal-vivid" />,
        badge: 'RUN',
      })
    }

    const scored: Array<SearchResult & { score: number }> = []

    for (const item of allItems) {
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

    for (const leader of leaders) {
      const label = leader.label.toLowerCase()
      const sub = (leader.sublabel ?? '').toLowerCase()
      let score = -1
      if (label.includes(q)) score = 55
      else if (sub.includes(q)) score = 35
      if (score > 0) scored.push({ ...leader, score })
    }

    scored.sort((a, b) => b.score - a.score)
    return [...directCmd, ...scored.slice(0, 30)]
  }, [query, allItems, quickJumps, commandItems, leaders])

  const effectiveIdx = results.length > 0 ? Math.min(activeIdx, results.length - 1) : 0
  const activeItem = results[effectiveIdx] ?? null

  const select = useCallback(
    (result: SearchResult) => {
      setOpen(false)
      setQuery('')
      router.push(result.href)
    },
    [router],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!results.length) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((prev) => Math.min(prev + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' && results[effectiveIdx]) {
        e.preventDefault()
        select(results[effectiveIdx])
      }
    },
    [results, effectiveIdx, select],
  )

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
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 transition-all"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Universal Search & Commands"
    >
      <div className="w-full max-w-4xl mt-[6vh] bg-bg-panel border border-bg-border/80 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[78vh] animate-in fade-in zoom-in-95 duration-150">
        {/* ── Search Input Bar ── */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-bg-border/80 bg-bg-panel shrink-0">
          <Search size={18} className="text-teal-vivid shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIdx(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, assets, profiles, or terminal commands (e.g. KIMCHI, FEAR, /saham)…"
            className="flex-1 bg-transparent text-sm font-medium text-text-primary placeholder:text-text-muted outline-none"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('')
                setActiveIdx(0)
              }}
              className="p-1 text-text-muted hover:text-text-primary transition-colors"
              title="Clear search"
            >
              <X size={15} />
            </button>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <kbd className="text-[10px] font-mono text-text-muted bg-bg-base border border-bg-border px-1.5 py-0.5 rounded">
              ESC
            </kbd>
          </div>
        </div>

        {/* ── Split View Body (Results + Preview Pane) ── */}
        <div className="flex-1 flex overflow-hidden min-h-[360px]">
          {/* Left Column: Results List */}
          <div className="flex-1 overflow-y-auto scrollbar-thin py-2 border-r border-bg-border/60">
            {results.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-text-muted">
                No matching results for &quot;{query}&quot;
              </div>
            ) : (
              sections.map((section) => (
                <div key={section.title} className="mb-2.5">
                  <div className="px-3 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-text-muted/60 select-none">
                    {section.title}
                  </div>
                  {section.items.map((item) => {
                    const globalIdx = results.findIndex((r) => r.id === item.id)
                    const isSelected = globalIdx === effectiveIdx

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                          isSelected
                            ? 'bg-teal-dim/30 text-teal-vivid border-l-2 border-teal-vivid'
                            : 'text-text-secondary hover:bg-bg-raised/60 hover:text-text-primary border-l-2 border-transparent'
                        }`}
                        onMouseDown={() => select(item)}
                        onMouseEnter={() => setActiveIdx(globalIdx)}
                      >
                        <span className="shrink-0 p-1 rounded bg-bg-base/60 border border-bg-border/40">
                          {item.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold truncate text-text-primary">
                              {item.label}
                            </span>
                            {item.badge && (
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-bg-base border border-bg-border text-text-muted uppercase shrink-0">
                                {item.badge}
                              </span>
                            )}
                          </div>
                          {item.sublabel && (
                            <div className="text-[11px] text-text-muted truncate mt-0.5">
                              {item.sublabel}
                            </div>
                          )}
                        </div>
                        <ArrowRight
                          size={12}
                          className={`shrink-0 transition-opacity ${
                            isSelected ? 'opacity-100 text-teal-vivid' : 'opacity-0'
                          }`}
                        />
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* Right Column: Raycast/Linear Preview Pane */}
          <div className="w-[42%] hidden sm:flex flex-col justify-between p-5 bg-bg-base/40 overflow-y-auto">
            {activeItem ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-bg-panel border border-bg-border/80 shrink-0">
                    {activeItem.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[9px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded bg-bg-panel border border-bg-border/60 text-text-muted">
                      {activeItem.section}
                    </span>
                    <h4 className="text-sm font-bold text-text-primary truncate mt-1">
                      {activeItem.label}
                    </h4>
                    {activeItem.sublabel && (
                      <p className="text-xs text-text-muted font-mono truncate">
                        {activeItem.sublabel}
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-bg-border/60 bg-bg-panel/70 space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted/60">
                    Description
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {activeItem.description ?? 'Quick navigation entry.'}
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-bg-border/60 bg-bg-panel/70 space-y-1.5 font-mono text-[11px]">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted/60">
                    Destination
                  </div>
                  <div className="text-teal-vivid truncate bg-bg-base/60 px-2 py-1 rounded border border-bg-border/40">
                    {activeItem.href}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-text-muted text-xs">
                <Globe size={24} className="mb-2 opacity-40 text-teal-vivid" />
                <span>Select an item to view preview</span>
              </div>
            )}

            {/* Shortcut actions guide */}
            <div className="pt-3 border-t border-bg-border/60 flex items-center justify-between text-[11px] font-mono text-text-muted">
              <span className="flex items-center gap-1">
                <CornerDownLeft size={12} className="text-teal-vivid" />
                <span>Open</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="bg-bg-panel px-1 rounded border border-bg-border">↑</kbd>
                <kbd className="bg-bg-panel px-1 rounded border border-bg-border">↓</kbd>
                <span>Navigate</span>
              </span>
              <span>
                <kbd className="bg-bg-panel px-1 rounded border border-bg-border">ESC</kbd> Close
              </span>
            </div>
          </div>
        </div>

        {/* ── Status Bar Footer ── */}
        <div className="px-4 py-2 border-t border-bg-border/80 bg-bg-panel/80 flex items-center justify-between text-[11px] font-mono text-text-muted shrink-0">
          <div className="flex items-center gap-2">
            <span>{results.length} items available</span>
            {!query && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-teal-dim/20 text-teal-vivid font-medium">
                Quick Jumps Mode
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline">NEXUS Intelligence Terminal</span>
          </div>
        </div>
      </div>
    </div>
  )
}
