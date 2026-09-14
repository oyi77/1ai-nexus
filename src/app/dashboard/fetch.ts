import type {
  Regime, Ticker, IntelScore, SymbolScore, IdxIdea, MemeToken, NewsItem,
  DexTrending, WhaleMove, ActivityEvent, AlphaSignalCard, ThesisCard, TrendingCard,
  MacroCountry,
} from './types'

export interface DashboardState {
  setRegime: React.Dispatch<React.SetStateAction<Regime | null>>
  setTickers: React.Dispatch<React.SetStateAction<Ticker[]>>
  setIntel: React.Dispatch<React.SetStateAction<IntelScore | null>>
  setSymbolScores: React.Dispatch<React.SetStateAction<SymbolScore[]>>
  setIdxIdeas: React.Dispatch<React.SetStateAction<IdxIdea[]>>
  setIdxTradeDate: React.Dispatch<React.SetStateAction<string>>
  setMeme: React.Dispatch<React.SetStateAction<MemeToken[]>>
  setNews: React.Dispatch<React.SetStateAction<NewsItem[]>>
  setDex: React.Dispatch<React.SetStateAction<DexTrending[]>>
  setWhaleMoves: React.Dispatch<React.SetStateAction<WhaleMove[]>>
  setActivity: React.Dispatch<React.SetStateAction<ActivityEvent[]>>
  setAlphaSignals: React.Dispatch<React.SetStateAction<AlphaSignalCard[]>>
  setThesis: React.Dispatch<React.SetStateAction<ThesisCard | null>>
  setTrending: React.Dispatch<React.SetStateAction<TrendingCard[]>>
  setStatus: React.Dispatch<React.SetStateAction<'live' | 'stale' | 'error'>>
  setMacro: React.Dispatch<React.SetStateAction<Record<string, MacroCountry>>>
  setLastUpdated: React.Dispatch<React.SetStateAction<string>>
}

export async function fetchAll(state: DashboardState): Promise<void> {
  const results = await Promise.allSettled([
    fetch('/api/v1/fear-greed').then(r => r.json()),
    fetch('/api/v1/market/prices').then(r => r.json()),
    fetch('/api/v1/intelligence-score').then(r => r.json()),
    fetch('/api/v1/market-score').then(r => r.json()),
    fetch('/api/v1/saham/watchlist-ideas?limit=8').then(r => r.json()),
    fetch('/api/v1/meme/leaderboard').then(r => r.json()),
    fetch('/api/v1/news?category=crypto&limit=12').then(r => r.json()),
    fetch('/api/v1/dex/trending?network=solana').then(r => r.json()),
    fetch('/api/v1/whale-alert').then(r => r.json()),
    fetch('/api/v1/alpha-feed?limit=6').then(r => r.json()),
    fetch('/api/v1/token/thesis?symbol=BTC').then(r => r.json()),
    fetch('/api/v1/feed?limit=3').then(r => r.json()),
    fetch('/api/v1/global-macro').then(r => r.json()),
  ])

  const val = <T,>(i: number): T | null =>
    results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<T>).value : null

  // Market regime
  const fg = val<{ data?: { composite?: Record<string, number & string>; regime?: Record<string, string>; headerMetrics?: Record<string, number> } }>(0)
  const comp = fg?.data?.composite
  const hm = fg?.data?.headerMetrics
  if (comp) {
    state.setRegime({
      score: Number(comp.score ?? 0),
      label: String(comp.label ?? 'Neutral'),
      change: Number(comp.change ?? 0),
      state: String(fg?.data?.regime?.state ?? '—'),
      stance: String(fg?.data?.regime?.stance ?? '—'),
      btcDom: Number(hm?.btcDom ?? 0),
      totalMcap: Number(hm?.totalMcap ?? 0),
      mcapChange24h: Number(hm?.mcapChange24h ?? 0),
    })
  }

  // Cross-asset tickers
  const prices = val<{ data?: { tickers?: Ticker[] } }>(1)
  if (Array.isArray(prices?.data?.tickers)) state.setTickers(prices.data.tickers)

  // Unified intelligence score
  const is = val<{ data?: IntelScore }>(2)
  if (is?.data) state.setIntel(is.data)

  // Per-symbol conviction
  const ms = val<{ data?: { scores?: SymbolScore[] } }>(3)
  if (Array.isArray(ms?.data?.scores)) {
    state.setSymbolScores([...ms.data.scores].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 12))
  }

  // IDX alpha ideas
  const idx = val<{ data?: { ideas?: IdxIdea[]; tradeDate?: string } }>(4)
  if (Array.isArray(idx?.data?.ideas)) {
    state.setIdxIdeas(idx.data.ideas)
    state.setIdxTradeDate(String(idx.data.tradeDate ?? ''))
  }

  // Meme alpha — surface only priced tokens with real volume.
  const mem = val<{ tokens?: MemeToken[] }>(5)
  if (Array.isArray(mem?.tokens)) {
    state.setMeme(
      mem.tokens
        .filter(t => Number(t.volume24h) > 0)
        .sort((a, b) => Number(b.volume24h) - Number(a.volume24h))
        .slice(0, 12),
    )
  }

  const nw = val<{ data?: { items?: Record<string, unknown>[] } }>(6)
  if (Array.isArray(nw?.data?.items)) {
    state.setNews(nw.data.items.slice(0, 12).map(n => ({
      id: String(n.id ?? ''),
      title: String(n.title ?? ''),
      url: String(n.url ?? ''),
      sourceId: String(n.sourceId ?? ''),
      publishedAt: String(n.publishedAt ?? ''),
      category: String(n.category ?? ''),
    })))
  }

  const dx = val<{ data?: { items?: Record<string, unknown>[] } }>(7)
  if (Array.isArray(dx?.data?.items)) {
    state.setDex(dx.data.items.slice(0, 10).map(d => ({
      name: String(d.symbol ?? d.name ?? ''),
      priceUsd: Number(d.priceUsd ?? 0),
      fdv: Number(d.fdv ?? 0),
      volume24h: Number(d.volume24h ?? 0),
      priceChange24h: Number(d.priceChange24h ?? 0),
    })))
  }

  const wh = val<{ data?: { items?: Record<string, unknown>[] } }>(8)
  if (Array.isArray(wh?.data?.items)) {
    state.setWhaleMoves(wh.data.items.slice(0, 10).map(w => ({
      id: String(w.id ?? ''),
      amount: Number(w.amount ?? 0),
      symbol: String(w.symbol ?? ''),
      usd: Number(w.usd ?? 0),
      from: String(w.from ?? ''),
      to: String(w.to ?? ''),
      link: w.link ? String(w.link) : undefined,
    })))
  }

  // Derived alpha signals (premium — stays empty for anonymous visitors)
  const af = val<{ data?: Record<string, unknown>[] }>(9)
  if (Array.isArray(af?.data)) {
    const mapped = af.data.slice(0, 6).map(s => ({
      id: String(s.id ?? ''),
      type: String(s.type ?? 'signal'),
      asset: String(s.asset ?? ''),
      strength: Number(s.strength ?? 0),
      confidence: Number(s.confidence ?? 0),
      headline: String(s.headline ?? ''),
      explanation: String(s.explanation ?? ''),
      source: String(s.source ?? ''),
      timestamp: s.timestamp ? new Date(String(s.timestamp)).toLocaleTimeString() : '',
    }))
    state.setAlphaSignals(mapped)
    state.setActivity(mapped.map(s => ({
      id: s.id, type: s.type, headline: s.headline, asset: s.asset,
      direction: String(af.data!.find(x => String(x.id ?? '') === s.id)?.direction ?? 'neutral'),
      strength: s.strength, timestamp: s.timestamp,
    })))
  }

  const th = val<Record<string, unknown>>(10)
  if (th?.thesis) {
    const dir = th.thesis === 'BULLISH' || th.thesis === 'BEARISH' ? th.thesis : 'NEUTRAL'
    state.setThesis({
      symbol: String(th.symbol ?? 'BTC'),
      thesis: dir as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
      confidence: Number(th.confidence ?? 0),
      totalSignals: Number(th.totalSignals ?? 0),
    })
  }

  const fd = val<{ top?: Record<string, unknown>[] }>(11)
  if (Array.isArray(fd?.top)) {
    state.setTrending(fd.top.slice(0, 3).map(i => ({
      id: String(i.id ?? ''),
      title: String(i.t ?? ''),
      source: String(i.s ?? ''),
    })))
  }


  // Global macro snapshot
  const mc = val<{ data?: Record<string, MacroCountry> }>(12)
  if (mc?.data && typeof mc.data === 'object') state.setMacro(mc.data)
  // "live" as long as the core market reads landed.
  const coreOk = results[0].status === 'fulfilled' || results[1].status === 'fulfilled'
  state.setStatus(coreOk ? 'live' : 'error')
  state.setLastUpdated(new Date().toLocaleTimeString())
}
