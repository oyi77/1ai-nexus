// ─────────────────────────────────────────────────────────────
// NEXUS Telegram Bot — Comprehensive Inline Keyboard Interface
// Fetches real data from API endpoints, matches web version features
// ─────────────────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org/bot'
const MAX_RETRIES = 3
const RETRY_BASE_MS = 1000

const registeredChats = new Set<string>()
let botToken = ''
let pollingOffset = 0
let isPolling = false
const startTime = Date.now()

// ─── Core API ────────────────────────────────────────────────

async function callTelegram(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const url = `${TELEGRAM_API}${botToken}/${method}`
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      })
      const data = await res.json() as { ok: boolean; result?: unknown; description?: string }
      if (data.ok) return data.result
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)))
        continue
      }
      throw new Error(`Telegram API error: ${data.description}`)
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err
      await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)))
    }
  }
}

// ─── API Data Fetching ───────────────────────────────────────

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4400'

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const json = await res.json() as { data?: T }
    return json.data ?? null
  } catch {
    return null
  }
}

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtPrice(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

// ─── Keyboard Builders ───────────────────────────────────────

interface Button { text: string; callback_data?: string; url?: string }

function keyboard(rows: Button[][]): { inline_keyboard: Button[][] } {
  return { inline_keyboard: rows }
}

const MAIN_MENU = keyboard([
  [{ text: '📊 Market Overview', callback_data: 'menu:market' }, { text: '🐋 Whale Intel', callback_data: 'menu:whale' }],
  [{ text: '💹 Trading', callback_data: 'menu:trading' }, { text: '🧠 Smart Money', callback_data: 'menu:smart' }],
  [{ text: '⛽ Gas & Network', callback_data: 'menu:network' }, { text: '📡 Signals', callback_data: 'menu:signals' }],
  [{ text: '📰 News & Macro', callback_data: 'menu:intel' }, { text: '🔔 Alerts', callback_data: 'menu:alerts' }],
  [{ text: '📊 Bot Status', callback_data: 'act:status' }, { text: '❓ Help', callback_data: 'act:help' }],
])

const BACK_ROW: Button[] = [{ text: '🔙 Back', callback_data: 'menu:main' }]
const MARKET_MENU = keyboard([
  [{ text: '🔥 Fear & Greed', callback_data: 'data:fear-greed' }, { text: '💲 Top Prices', callback_data: 'data:prices' }],
  [{ text: '📈 Sectors', callback_data: 'data:sectors' }, { text: '🌐 Macro', callback_data: 'data:macro' }],
  [{ text: '📊 Correlations', callback_data: 'data:correlations' }, { text: '💱 Forex', callback_data: 'data:forex' }],
  [{ text: '🏦 Equities', callback_data: 'data:equities' }, { text: '🌾 Commodities', callback_data: 'data:commodities' }],
  BACK_ROW,
])

const WHALE_MENU = keyboard([
  [{ text: '🐋 Whale Clusters', callback_data: 'data:whale-cluster' }, { text: '💰 Exchange Flows', callback_data: 'data:exchange-flow' }],
  [{ text: '📡 Mempool Radar', callback_data: 'data:mempool' }, { text: '🔍 Insider Detector', callback_data: 'data:insider' }],
  [{ text: '🏦 Entities', callback_data: 'data:entities' }],
  BACK_ROW,
])

const TRADING_MENU = keyboard([
  [{ text: '📊 Derivatives', callback_data: 'data:derivatives' }, { text: '💦 Liquidations', callback_data: 'data:liquidations' }],
  [{ text: '🔄 DEX Monitor', callback_data: 'data:dex' }, { text: '📡 New Pairs', callback_data: 'data:scanner' }],
  [{ text: '🪙 Tokens', callback_data: 'data:tokens' }, { text: '🔍 Token Search', callback_data: 'act:token-search' }],
  BACK_ROW,
])

const SMART_MENU = keyboard([
  [{ text: '🧠 Smart Money', callback_data: 'data:smart-money' }, { text: '📋 Copy Trades', callback_data: 'data:copy-trade' }],
  [{ text: '📈 Edge Report', callback_data: 'data:edge-report' }, { text: '📊 Signal Confidence', callback_data: 'data:signal-confidence' }],
  BACK_ROW,
])

const NETWORK_MENU = keyboard([
  [{ text: '⛽ Gas Tracker', callback_data: 'data:gas' }, { text: '📡 Mempool Stats', callback_data: 'data:mempool-stats' }],
  [{ text: '🔗 Stablecoins', callback_data: 'data:stablecoins' }, { text: '📊 DeFi TVL', callback_data: 'data:defi-tvl' }],
  [{ text: '💰 DeFi Yields', callback_data: 'data:defi-yields' }],
  BACK_ROW,
])

const SAFETY_MENU = keyboard([
  [{ text: '🛡 RugCheck', callback_data: 'act:rugcheck' }, { text: '📊 System Status', callback_data: 'data:status' }],
  BACK_ROW,
])

const INTEL_MENU = keyboard([
  [{ text: '📰 News Feed', callback_data: 'data:news' }, { text: '🌤 Weather Signals', callback_data: 'data:weather' }],
  [{ text: '📊 Alt Data', callback_data: 'data:alt-data' }, { text: '📰 Feed Sources', callback_data: 'data:feeds' }],
  BACK_ROW,
])

const SIGNALS_MENU = keyboard([
  [{ text: '📡 Latest Signals', callback_data: 'data:signals' }],
  [{ text: '🔔 Subscribe Signals', callback_data: 'act:signal-sub' }, { text: '🔕 Unsubscribe', callback_data: 'act:signal-unsub' }],
  BACK_ROW,
])

const ALERTS_MENU = keyboard([
  [{ text: '🔔 My Alerts', callback_data: 'data:alerts' }, { text: '📋 Templates', callback_data: 'data:alert-templates' }],
  [{ text: '➕ Create Alert', callback_data: 'act:create-alert' }],
  BACK_ROW,
])

// ─── Data Formatters ─────────────────────────────────────────

async function formatFearGreed(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/fear-greed')
  if (!d) return '❌ Failed to fetch Fear & Greed data'
  const composite = d.composite as { score?: number; label?: string } | undefined
  const regime = d.regime as { state?: string; stance?: string } | undefined
  const score = composite?.score ?? 0
  const emoji = score >= 75 ? '🟢' : score >= 50 ? '🟡' : score >= 25 ? '🟠' : '🔴'
  return [
    `${emoji} *Fear & Greed Index*`,
    '',
    `Score: *${score}/100* — ${composite?.label ?? 'N/A'}`,
    regime ? `Regime: ${regime.state} · Stance: ${regime.stance}` : '',
    '',
    'Updated: ' + new Date().toLocaleTimeString(),
  ].filter(Boolean).join('\n')
}

async function formatPrices(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>[]>('/api/v1/market/prices')
  if (!d?.length) return '❌ Failed to fetch prices'
  const lines = ['💲 *Top Prices*', '']
  for (const t of d.slice(0, 10)) {
    const sym = t.symbol ?? '?'
    const price = typeof t.price === 'number' ? t.price : parseFloat(String(t.price ?? 0))
    const change = typeof t.change === 'number' ? t.change : parseFloat(String(t.change ?? 0))
    const arrow = change >= 0 ? '🟢' : '🔴'
    lines.push(`${arrow} *${sym}* ${fmtPrice(price)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`)
  }
  return lines.join('\n')
}

async function formatExchangeFlow(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/exchange-flow')
  if (!d) return '❌ Failed to fetch exchange flows'
  const totalIn = (d.totalInflow as number) ?? 0
  const totalOut = (d.totalOutflow as number) ?? 0
  const net = (d.totalNetFlow as number) ?? 0
  const signal = (d.signal as string) ?? 'neutral'
  const flows = (d.flows as Array<Record<string, unknown>>) ?? []
  const lines = [
    '💰 *Exchange Flows*',
    '',
    `Inflow: *${fmtUsd(totalIn)}*`,
    `Outflow: *${fmtUsd(totalOut)}*`,
    `Net: *${net > 0 ? '+' : ''}${fmtUsd(net)}* ${net > 0 ? '🔴 Bearish' : '🟢 Bullish'}`,
    `Signal: *${signal.toUpperCase()}*`,
    '',
    '*Top Exchanges:*',
  ]
  for (const f of flows.slice(0, 5)) {
    const ex = String(f.exchange ?? '?').toUpperCase()
    const nf = (f.netFlow as number) ?? 0
    lines.push(`  ${ex}: ${nf > 0 ? '+' : ''}${fmtUsd(nf)}`)
  }
  return lines.join('\n')
}

async function formatWhaleClusters(): Promise<string> {
  const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/whale-cluster')
  if (!d?.length) return '🐋 *Whale Clusters*\n\nNo clusters detected yet'
  const lines = ['🐋 *Whale Clusters*', '', `${d.length} clusters identified`, '']
  for (const c of d.slice(0, 5)) {
    const name = String(c.name ?? c.label ?? 'Unknown')
    const wallets = (c.walletCount as number) ?? (c.wallets as number) ?? 0
    const value = (c.totalValue as number) ?? 0
    lines.push(`• *${name}* — ${wallets} wallets · ${fmtUsd(value)}`)
  }
  return lines.join('\n')
}

async function formatMempool(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/mempool?action=stats')
  if (!d) return '❌ Failed to fetch mempool data'
  const count = (d.count as number) ?? 0
  const fees = d.fees as Record<string, number> | undefined
  const congestion = d.congestion as { level?: string; description?: string } | undefined
  const lines = [
    '📡 *Mempool Radar*',
    '',
    `Pending Txs: *${count.toLocaleString()}*`,
    congestion ? `Congestion: *${congestion.level}* — ${congestion.description}` : '',
    '',
    '*Fee Estimates (sat/vB):*',
  ]
  if (fees) {
    for (const [key, val] of Object.entries(fees)) {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
      lines.push(`  ${label}: *${val}*`)
    }
  }
  return lines.filter(Boolean).join('\n')
}

async function formatInsider(): Promise<string> {
  const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/insider')
  if (!d?.length) return '🔍 *Insider Detector*\n\nNo insider signals detected'
  const lines = ['🔍 *Insider Detector*', '', `${d.length} signals detected`, '']
  for (const s of d.slice(0, 5)) {
    const wallet = String(s.wallet ?? s.address ?? '?').slice(0, 10)
    const token = String(s.token ?? s.symbol ?? '?')
    const value = (s.valueUsd as number) ?? (s.amountUsd as number) ?? 0
    lines.push(`• *${token}* — ${fmtUsd(value)} via ${wallet}...`)
  }
  return lines.join('\n')
}

async function formatDerivatives(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/derivatives?limit=10')
  if (!d) return '❌ Failed to fetch derivatives'
  const pairs = (d.topPairs as Array<Record<string, unknown>>) ?? []
  const lines = ['📊 *Derivatives Dashboard*', '']
  for (const p of pairs.slice(0, 8)) {
    const sym = String(p.symbol ?? p.pair ?? '?')
    const price = typeof p.price === 'number' ? p.price : 0
    const funding = typeof p.fundingRate === 'number' ? p.fundingRate : 0
    const vol = typeof p.volume24h === 'number' ? p.volume24h : 0
    lines.push(`*${sym}* ${fmtPrice(price)} | FR: ${(funding * 100).toFixed(4)}% | Vol: ${fmtUsd(vol)}`)
  }
  return lines.join('\n')
}

async function formatLiquidations(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/liquidations?symbol=BTC')
  if (!d) return '❌ Failed to fetch liquidations'
  const spotlight = d.spotlight as Record<string, unknown> | undefined
  const lines = ['💦 *Liquidation Heatmap*', '']
  if (spotlight) {
    lines.push(`BTC: *${fmtPrice((spotlight.price as number) ?? 0)}*`)
    lines.push(`Funding: *${((spotlight.fundingRate as number) ?? 0 * 100).toFixed(4)}%*`)
  }
  lines.push('', 'Open /liquidations on web for full heatmap')
  return lines.join('\n')
}

async function formatGas(): Promise<string> {
  const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/gas')
  if (!d?.length) return '❌ Failed to fetch gas data'
  const lines = ['⛽ *Gas Tracker*', '']
  for (const chain of d.slice(0, 6)) {
    const name = String(chain.chain ?? chain.name ?? '?')
    const prices = chain.prices as Array<Record<string, unknown>> | undefined
    if (prices?.[0]) {
      const p = prices[0]
      const slow = p.slow ?? p.safe ?? '?'
      const fast = p.fast ?? p.fastest ?? '?'
      const unit = String(p.unit ?? 'gwei')
      lines.push(`*${name}*: ${slow}–${fast} ${unit}`)
    }
  }
  return lines.join('\n')
}

async function formatSmartMoney(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/smart-money?pageSize=5')
  if (!d) return '❌ Failed to fetch smart money data'
  const wallets = (d.wallets as Array<Record<string, unknown>>) ?? []
  const lines = ['🧠 *Smart Money*', '', `${wallets.length} top wallets tracked`, '']
  for (const w of wallets.slice(0, 5)) {
    const addr = String(w.address ?? '?').slice(0, 10)
    const pnl = (w.pnl7d as number) ?? 0
    const winRate = (w.winRate as number) ?? 0
    lines.push(`• \`${addr}...\` PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}% WR: ${winRate.toFixed(0)}%`)
  }
  return lines.join('\n')
}

async function formatNews(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/news')
  if (!d) return '❌ Failed to fetch news'
  const items = (d.items as Array<Record<string, unknown>>) ?? (d as unknown as Array<Record<string, unknown>>) ?? []
  const lines = ['📰 *News Feed*', '']
  for (const item of (Array.isArray(items) ? items : []).slice(0, 5)) {
    const title = String(item.title ?? '?').slice(0, 60)
    const source = String(item.sourceId ?? item.source ?? '?')
    lines.push(`• *${title}* — _${source}_`)
  }
  if (lines.length === 2) lines.push('No recent news')
  return lines.join('\n')
}

async function formatWeather(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/weather-signals?action=anomalies')
  if (!d) return '❌ Failed to fetch weather data'
  const results = (d.results as Array<Record<string, unknown>>) ?? []
  const lines = ['🌤 *Weather Signals*', '', `Regions scanned: ${(d.scannedRegions as number) ?? 0}`, `Anomalies: ${(d.anomalyRegions as number) ?? 0}`, '']
  for (const r of results.slice(0, 3)) {
    const region = String(r.region ?? '?')
    const anomalies = r.anomalies as Array<Record<string, unknown>> | undefined
    const commodities = (r.affectedCommodities as Array<{ commodity?: string }>) ?? []
    if (anomalies?.length) {
      const maxZ = Math.max(...anomalies.map(a => Math.abs((a.zScore as number) ?? 0)))
      lines.push(`🔴 *${region}* — z-score ${maxZ.toFixed(1)}σ`)
      lines.push(`  Affects: ${commodities.map(c => c.commodity).join(', ')}`)
    }
  }
  if (lines.length === 5) lines.push('No anomalies detected')
  return lines.join('\n')
}

async function formatStatus(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/status')
  if (!d) return '❌ Failed to fetch status'
  const services = (d.services as Array<Record<string, unknown>>) ?? []
  const uptimeMs = Date.now() - startTime
  const uptimeMin = Math.floor(uptimeMs / 60_000)
  const lines = [
    '📊 *NEXUS Bot Status*',
    '',
    `Registered chats: *${registeredChats.size}*`,
    `Polling: *${isPolling ? 'active' : 'inactive'}*`,
    `Uptime: *${uptimeMin}m*`,
    '',
    '*Services:*',
  ]
  for (const s of services.slice(0, 8)) {
    const name = String(s.name ?? '?')
    const status = String(s.status ?? '?')
    const emoji = status === 'healthy' ? '🟢' : status === 'degraded' ? '🟡' : '🔴'
    lines.push(`  ${emoji} ${name}`)
  }
  return lines.join('\n')
}

async function formatTokens(): Promise<string> {
  const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/tokens')
  if (!d?.length) return '❌ Failed to fetch tokens'
  const lines = ['🪙 *Top Tokens*', '']
  for (const t of d.slice(0, 10)) {
    const sym = String(t.symbol ?? '?')
    const price = typeof t.price === 'number' ? t.price : 0
    const change = typeof t.change24h === 'number' ? t.change24h : 0
    const vol = typeof t.volume24h === 'number' ? t.volume24h : 0
    const arrow = change >= 0 ? '🟢' : '🔴'
    lines.push(`${arrow} *${sym}* ${fmtPrice(price)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%) Vol: ${fmtUsd(vol)}`)
  }
  return lines.join('\n')
}

async function formatSectors(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/defi/overview')
  if (!d) return '❌ Failed to fetch sectors'
  const chains = (d.chains as Array<Record<string, unknown>>) ?? []
  const totalTvl = chains.reduce((s, c) => s + ((c.tvl as number) ?? 0), 0)
  const lines = ['📈 *Sectors / Chains TVL*', '', `Total TVL: *${fmtUsd(totalTvl)}*`, '']
  for (const c of chains.slice(0, 8)) {
    const name = String(c.name ?? '?')
    const tvl = (c.tvl as number) ?? 0
    const dom = totalTvl > 0 ? ((tvl / totalTvl) * 100).toFixed(1) : '0'
    lines.push(`• *${name}* ${fmtUsd(tvl)} (${dom}%)`)
  }
  return lines.join('\n')
}

async function formatMacro(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/macro')
  if (!d) return '❌ Failed to fetch macro data'
  const indicators = (d.indicators as Array<Record<string, unknown>>) ?? []
  const lines = ['🌐 *Macro Dashboard*', '']
  for (const ind of indicators.slice(0, 8)) {
    const name = String(ind.name ?? ind.id ?? '?')
    const value = ind.latestValue ?? ind.value ?? '?'
    const change = typeof ind.changePercent === 'number' ? ind.changePercent : 0
    const arrow = change >= 0 ? '🟢' : '🔴'
    lines.push(`${arrow} *${name}*: ${value} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`)
  }
  if (lines.length === 2) lines.push('No macro data available')
  return lines.join('\n')
}

async function formatStablecoins(): Promise<string> {
  const d = await fetchApi<Record<string, unknown>>('/api/v1/stablecoins')
  if (!d) return '❌ Failed to fetch stablecoins'
  const coins = (d.stablecoins as Array<Record<string, unknown>>) ?? []
  const lines = ['🔗 *Stablecoins*', '']
  for (const c of coins.slice(0, 6)) {
    const sym = String(c.symbol ?? '?')
    const price = typeof c.price === 'number' ? c.price : 0
    const mcap = typeof c.marketCap === 'number' ? c.marketCap : 0
    const dev = typeof c.deviation === 'number' ? c.deviation : 0
    const status = (c.pegStatus as string) ?? '?'
    const emoji = status === 'ON PEG' ? '🟢' : '🔴'
    lines.push(`${emoji} *${sym}* $${price.toFixed(4)} | Dev: ${dev.toFixed(3)}% | MCap: ${fmtUsd(mcap)}`)
  }
  return lines.join('\n')
}

// ─── Handler Map ─────────────────────────────────────────────

type DataHandler = () => Promise<string>

const DATA_HANDLERS: Record<string, DataHandler> = {
  'fear-greed': formatFearGreed,
  'prices': formatPrices,
  'sectors': formatSectors,
  'macro': formatMacro,
  'correlations': async () => {
    const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/correlations')
    if (!d?.length) return '📊 *Correlations*\n\nNo correlation data available'
    const lines = ['📊 *Correlations*', '']
    for (const c of d.slice(0, 6)) {
      const pair = String(c.pair ?? '?')
      const corr = typeof c.correlation === 'number' ? c.correlation : 0
      const sig = String(c.significance ?? '?')
      lines.push(`• *${pair}*: ${corr.toFixed(3)} (${sig})`)
    }
    return lines.join('\n')
  },
  'forex': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/macro?category=forex')
    return d ? '💱 *Forex*\n\nSee /macro for forex data' : '❌ No forex data'
  },
  'equities': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/macro?category=equities')
    return d ? '🏦 *Equities*\n\nSee /macro for equity data' : '❌ No equity data'
  },
  'commodities': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/macro?category=commodities')
    return d ? '🌾 *Commodities*\n\nSee /macro for commodity data' : '❌ No commodity data'
  },
  'whale-cluster': formatWhaleClusters,
  'exchange-flow': formatExchangeFlow,
  'mempool': formatMempool,
  'insider': formatInsider,
  'entities': async () => {
    const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/entities')
    if (!d?.length) return '🏦 *Entities*\n\nNo entities data'
    const lines = ['🏦 *Top Entities*', '']
    for (const e of d.slice(0, 6)) {
      const name = String(e.name ?? '?')
      const type = String(e.type ?? '?')
      const value = (e.totalUsdValue as number) ?? 0
      lines.push(`• *${name}* (${type}) — ${fmtUsd(value)}`)
    }
    return lines.join('\n')
  },
  'derivatives': formatDerivatives,
  'liquidations': formatLiquidations,
  'dex': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/exchanges?limit=5')
    if (!d) return '❌ Failed to fetch DEX data'
    const lines = ['🔄 *DEX Monitor*', '']
    for (const [ex, tickers] of Object.entries(d)) {
      if (Array.isArray(tickers) && tickers.length) {
        lines.push(`*${ex.toUpperCase()}*: ${tickers.length} pairs`)
      }
    }
    return lines.join('\n')
  },
  'scanner': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/derivatives?limit=10')
    if (!d) return '❌ Failed to fetch scanner data'
    const pairs = (d.topPairs as Array<Record<string, unknown>>) ?? []
    const lines = ['📡 *New Pairs Scanner*', '', `${pairs.length} pairs tracked`, '']
    for (const p of pairs.slice(0, 6)) {
      const sym = String(p.symbol ?? '?')
      const vol = typeof p.volume24h === 'number' ? p.volume24h : 0
      lines.push(`• *${sym}* Vol: ${fmtUsd(vol)}`)
    }
    return lines.join('\n')
  },
  'tokens': formatTokens,
  'smart-money': formatSmartMoney,
  'copy-trade': async () => {
    const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/copy-trade')
    if (!d?.length) return '📋 *Copy Trades*\n\nNo copy trade signals'
    const lines = ['📋 *Copy Trade Signals*', '']
    for (const s of d.slice(0, 5)) {
      const token = String(s.token ?? s.symbol ?? '?')
      const value = (s.valueUsd as number) ?? 0
      lines.push(`• *${token}* — ${fmtUsd(value)}`)
    }
    return lines.join('\n')
  },
  'edge-report': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/edge-report')
    if (!d) return '📈 *Edge Report*\n\nNo report available'
    return `📈 *Edge Report*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'signal-confidence': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/signal-confidence')
    if (!d) return '📊 *Signal Confidence*\n\nNo data'
    return `📊 *Signal Confidence*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'signals': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/alpha-engine')
    if (!d) return '📡 *No active signals*\n\nNo signals currently.'
    const signals = (d.signals ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(signals) || !signals.length) return '📡 *No active signals*\n\nNo signals currently.'
    const lines = ['📡 *Active Signals* — ' + signals.length + ' found', '']
    for (const s of signals.slice(0, 10)) {
      const dir = String(s.direction ?? 'neutral')
      const emoji = dir === 'bullish' ? '🟢' : dir === 'bearish' ? '🔴' : '⚪'
      const remaining = Math.max(0, Math.round(((s.expiresAt as number) - Date.now()) / 3_600_000))
      lines.push(emoji + ' *' + s.symbol + '* ' + dir.toUpperCase() + ' ' + s.confidence + '% (' + remaining + 'h)')
      lines.push('   ' + String(s.reasoning ?? '').slice(0, 80))
      if (s.entry != null) lines.push('   Entry: $' + Number(s.entry).toFixed(2))
      lines.push('')
    }
    return lines.join('\n')
  },
  'gas': formatGas,
  'mempool-stats': formatMempool,
  'stablecoins': formatStablecoins,
  'defi-tvl': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/defi/tvl')
    if (!d) return '📊 *DeFi TVL*\n\nNo data'
    return `📊 *DeFi TVL*\n\nTotal: *${fmtUsd((d.totalTvl as number) ?? 0)}*`
  },
  'defi-yields': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/defi/yields')
    if (!d) return '💰 *DeFi Yields*\n\nNo data'
    return `💰 *DeFi Yields*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'status': formatStatus,
  'news': formatNews,
  'weather': formatWeather,
  'alt-data': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/alt-data')
    if (!d) return '📊 *Alt Data*\n\nNo data'
    return `📊 *Alt Data*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'feeds': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/feeds')
    if (!d) return '📰 *Feed Sources*\n\nNo data'
    return `📰 *Feed Sources*\n\nActive sources configured`
  },
  'alerts': async () => {
    const d = await fetchApi<Record<string, unknown>>('/api/v1/alerts')
    if (!d) return '🔔 *Alerts*\n\nNo alerts configured. Create one via web.'
    return `🔔 *Alerts*\n\n${JSON.stringify(d).slice(0, 500)}`
  },
  'alert-templates': async () => {
    const d = await fetchApi<Array<Record<string, unknown>>>('/api/v1/alerts/templates')
    if (!d?.length) return '📋 *Alert Templates*\n\nNo templates available'
    const lines = ['📋 *Alert Templates*', '']
    for (const t of d.slice(0, 5)) {
      lines.push(`• *${String(t.name ?? '?')}* — ${String(t.description ?? '').slice(0, 50)}`)
    }
    return lines.join('\n')
  },
}

const MENU_MAP: Record<string, { inline_keyboard: Button[][] }> = {
  main: MAIN_MENU,
  market: MARKET_MENU,
  whale: WHALE_MENU,
  trading: TRADING_MENU,
  smart: SMART_MENU,
  network: NETWORK_MENU,
  safety: SAFETY_MENU,
  intel: INTEL_MENU,
  alerts: ALERTS_MENU,
  signals: SIGNALS_MENU,
}

// ─── Message/Callback Handlers ───────────────────────────────

interface TgMessage {
  text?: string
  chat: { id: number }
  message_id?: number
  from?: { id: number; username?: string }
}

interface TgCallbackQuery {
  data?: string
  message?: { chat: { id: number }; message_id?: number }
  id: string
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const chatId = String(msg.chat.id)
  const text = (msg.text ?? '').trim().toLowerCase()

  // /start and /sub both register the chat AND attempt to link it to an app user
  // via a matching Telegram username (persisted by linkTelegram on the web side).
  if (text === '/start' || text === '/sub') {
    registeredChats.add(chatId)
    if (msg.from?.username) {
      try {
        const alert = await import('./alert-service')
        await alert.linkTelegramByUsername(msg.from.username, chatId)
      } catch {
        // Non-fatal — linking is best-effort.
      }
    }
    if (text === '/sub') {
      const sub = await import('./signal-publisher')
      sub.subscribeSignals(chatId)
    }
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: text === '/sub'
        ? '🔔 *Signal Subscription Active*\n\nYou\'ll now receive high-confidence signals automatically as they\'re generated.'
        : '🔔 *NEXUS Intelligence Terminal*\n\nWelcome! Tap a button to explore:',
      parse_mode: 'Markdown',
      reply_markup: MAIN_MENU,
    })
    return
  }

  if (text === '/stop') {
    registeredChats.delete(chatId)
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '🔕 Unregistered from alerts. Send /start to re-enable.',
    })
    return
  }

  // Default: show main menu
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: '🔔 *NEXUS Intelligence Terminal*\n\nChoose a category:',
    parse_mode: 'Markdown',
    reply_markup: MAIN_MENU,
  })
}

async function handleCallback(cb: TgCallbackQuery): Promise<void> {
  if (!cb.data || !cb.message) return
  const chatId = String(cb.message.chat.id)
  const msgId = cb.message.message_id
  const [action, param] = cb.data.split(':')

  try {
    if (action === 'menu') {
      const menu = MENU_MAP[param]
      if (menu) {
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text: param === 'main' ? '🔔 *NEXUS Intelligence Terminal*\n\nChoose a category:' : `📂 *${param.charAt(0).toUpperCase() + param.slice(1)}*\n\nSelect a feature:`,
          parse_mode: 'Markdown',
          reply_markup: menu,
        })
      }
    } else if (action === 'data') {
      const handler = DATA_HANDLERS[param]
      if (handler) {
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Loading...' })
        const text = await handler()
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text,
          parse_mode: 'Markdown',
          reply_markup: keyboard([BACK_ROW]),
        })
      }
    } else if (action === 'act') {
      if (param === 'status') {
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Loading status...' })
        const text = await formatStatus()
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text,
          parse_mode: 'Markdown',
          reply_markup: keyboard([BACK_ROW]),
        })
      } else if (param === 'help') {
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text: [
            '❓ *NEXUS Bot Help*',
            '',
            'Navigate using the inline buttons below each message.',
            '',
            '• 📊 Market — prices, fear/greed, sectors, macro',
            '• 🐋 Whale — clusters, exchange flows, mempool, insider',
            '• 💹 Trading — derivatives, liquidations, DEX, scanner',
            '• 🧠 Smart Money — top wallets, copy trades, signals',
            '• ⛽ Network — gas, stablecoins, DeFi',
            '• 🛡 Safety — rugcheck, system status',
            '• 📰 Intel — news, weather, alt data',
            '• 🔔 Alerts — manage your alert rules',
            '',
            'Send /start anytime to return to the main menu.',
          ].join('\n'),
          parse_mode: 'Markdown',
          reply_markup: keyboard([BACK_ROW]),
        })
      } else if (param === 'rugcheck') {
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Enter a token address to check.' })
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🛡 *RugCheck*\n\nSend a token contract address to check safety.\nExample: `0xdac17f958d2ee523a2206206994597c13d831ec7`',
          parse_mode: 'Markdown',
        })
      } else if (param === 'token-search') {
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🔍 *Token Search*\n\nSend a token symbol or contract address.',
          parse_mode: 'Markdown',
        })
      } else if (param === 'create-alert') {
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '➕ *Create Alert*\n\nUse the web dashboard at tracker.aitradepulse.com/alerts to create custom alert rules.',
          parse_mode: 'Markdown',
          reply_markup: keyboard([[{ text: '🌐 Open Dashboard', url: 'https://tracker.aitradepulse.com/alerts' }], BACK_ROW]),
        })
      } else if (param === 'signal-sub') {
        const sub = await import('./signal-publisher')
        sub.subscribeSignals(chatId)
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Subscribed!' })
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🔔 *Signal Subscription Active*\n\nYou\'ll now receive high-confidence signals automatically as they\'re generated.',
          parse_mode: 'Markdown',
        })
      } else if (param === 'signal-unsub') {
        const sub = await import('./signal-publisher')
        sub.unsubscribeSignals(chatId)
        await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: '🔕 Unsubscribed.' })
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🔕 *Signal Subscription Cancelled*\n\nYou will no longer receive automatic signal broadcasts.',
          parse_mode: 'Markdown',
        })
      }
    }
  } catch (err) {
    console.error('[Telegram] Callback error:', (err as Error).message)
    await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Error loading data' }).catch(() => {})
  }
}

// ─── Long Polling ────────────────────────────────────────────

async function pollUpdates(): Promise<void> {
  if (!botToken || isPolling) return
  isPolling = true

  while (isPolling) {
    try {
      const updates = await callTelegram('getUpdates', {
        offset: pollingOffset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query'],
      }) as Array<{
        update_id: number
        message?: TgMessage
        callback_query?: TgCallbackQuery
      }> | undefined

      if (updates?.length) {
        for (const update of updates) {
          pollingOffset = update.update_id + 1
          if (update.message) await handleMessage(update.message)
          if (update.callback_query) await handleCallback(update.callback_query)
        }
      }
    } catch {
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

// ─── Public API ──────────────────────────────────────────────

export function initTelegramBot(token?: string): void {
  botToken = token || process.env.TELEGRAM_BOT_TOKEN || ''
  if (!botToken) {
    console.warn('[Telegram] No TELEGRAM_BOT_TOKEN set — bot disabled')
    return
  }
  console.log('[Telegram] Bot initialized, starting polling...')
  void pollUpdates()
}

export async function sendTelegramAlert(chatId: string, message: string): Promise<boolean> {
  if (!botToken) return false
  try {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    })
    return true
  } catch (err) {
    console.error(`[Telegram] Failed to send alert to ${chatId}:`, (err as Error).message)
    return false
  }
}

export async function broadcastAlert(message: string): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0
  for (const chatId of registeredChats) {
    const ok = await sendTelegramAlert(chatId, message)
    if (ok) sent++
    else failed++
  }
  return { sent, failed }
}

export function registerChat(chatId: string): void {
  registeredChats.add(chatId)
}

export function unregisterChat(chatId: string): void {
  registeredChats.delete(chatId)
}

export function getRegisteredChats(): string[] {
  return Array.from(registeredChats)
}

export function getBotStatus(): { enabled: boolean; chatCount: number; polling: boolean; uptime: number } {
  return {
    enabled: !!botToken,
    chatCount: registeredChats.size,
    polling: isPolling,
    uptime: (Date.now() - startTime) / 1000,
  }
}

export function stopPolling(): void {
  isPolling = false
}
