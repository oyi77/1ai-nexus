// NEXUS Telegram Bot — API-backed message formatters.

import { fetchApi, fmtUsd, fmtPrice, registeredChats, isPolling, startTime } from './core'
import { auditRugcheckToken } from '@/lib/modules/meme/rugcheck'
import type { MemeRiskAudit } from '@/lib/modules/meme/types'
import { readSniperLog, sniperLogCounts } from '@/lib/modules/derived/sniper-log'

export async function formatFearGreed(): Promise<string> {
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

export async function formatPrices(): Promise<string> {
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

export async function formatExchangeFlow(): Promise<string> {
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

export async function formatWhaleClusters(): Promise<string> {
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

export async function formatMempool(): Promise<string> {
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

export async function formatInsider(): Promise<string> {
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

export async function formatDerivatives(): Promise<string> {
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

export async function formatLiquidations(): Promise<string> {
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

export async function formatGas(): Promise<string> {
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

export async function formatSmartMoney(): Promise<string> {
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

export async function formatNews(): Promise<string> {
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

export async function formatWeather(): Promise<string> {
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

export async function formatStatus(): Promise<string> {
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

export async function formatTokens(): Promise<string> {
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

export async function formatSectors(): Promise<string> {
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

export async function formatMacro(): Promise<string> {
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

export async function formatStablecoins(): Promise<string> {
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

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

export async function formatTokenCheck(input: string): Promise<string> {
  try {
    const contract = (input ?? '').trim()
    const isSolana = SOLANA_ADDRESS_REGEX.test(contract)
    const isEvm = EVM_ADDRESS_REGEX.test(contract)

    if (!isSolana && !isEvm) {
      return [
        '❌ *Invalid Token Contract*',
        '',
        `"${contract.slice(0, 44)}" is not a recognized token address.`,
        '',
        'Please provide a valid contract address:',
        '• *Solana:* 32–44 alphanumeric characters (Base58)',
        '• *EVM:* 42 characters starting with `0x` (Ethereum/Base/BSC)',
        '',
        'Example:',
        '`/check EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`',
        'Or simply paste the address directly into this chat.',
      ].join('\n')
    }

    let audit: MemeRiskAudit | null = null

    if (isSolana) {
      try {
        audit = await auditRugcheckToken('solana', contract)
      } catch {
        audit = null
      }
      if (!audit) {
        try {
          const resp = await fetchApi<{ audits?: MemeRiskAudit[] } | MemeRiskAudit[]>(
            `/api/v1/meme/risk?contract=${encodeURIComponent(contract)}&chain=solana`,
          )
          if (resp) {
            if (Array.isArray(resp)) {
              audit = resp[0] ?? null
            } else if (Array.isArray(resp.audits)) {
              audit = resp.audits[0] ?? null
            }
          }
        } catch {
          audit = null
        }
      }
    } else {
      try {
        const resp = await fetchApi<{ audits?: MemeRiskAudit[] } | MemeRiskAudit[]>(
          `/api/v1/meme/risk?contract=${encodeURIComponent(contract)}&chain=ethereum`,
        )
        if (resp) {
          if (Array.isArray(resp)) {
            audit = resp[0] ?? null
          } else if (Array.isArray(resp.audits)) {
            audit = resp.audits[0] ?? null
          }
        }
      } catch {
        audit = null
      }
    }

    const shortAddr = contract.length > 10 ? `${contract.slice(0, 6)}...${contract.slice(-4)}` : contract

    if (!audit) {
      const chainName = isSolana ? 'Solana' : 'EVM'
      const dexUrl = isSolana
        ? `https://dexscreener.com/solana/${contract}`
        : `https://dexscreener.com/ethereum/${contract}`
      return [
        '⚠️ *Security Audit Unavailable*',
        '',
        `Could not retrieve automated security report for ${chainName} contract \`${shortAddr}\`.`,
        '',
        'Possible reasons:',
        '• Newly created token not yet indexed by security scanners',
        '• Standard wallet address instead of a token mint',
        '• Upstream scanner rate limit or temporary network outage',
        '',
        `🔗 [Check on DexScreener](${dexUrl})`,
      ].join('\n')
    }

    const name = audit.name ? audit.name.replace(/[*_`[\]()]/g, '') : ''
    const symbol = audit.symbol ? audit.symbol.replace(/[*_`[\]()]/g, '') : ''
    const tokenDisplay = name && symbol
      ? `*${name}* (\`$${symbol}\`)`
      : symbol
      ? `*\$${symbol}*`
      : name
      ? `*${name}*`
      : '*Unknown Token*'

    const isHighRisk = !!(audit.isHoneypot || audit.riskLevel >= 3 || audit.canFreeze)
    const isCaution = !isHighRisk && !!(audit.riskLevel === 2 || audit.top10HolderPercent > 0.30 || audit.canMint)

    let verdictLabel: string
    if (isHighRisk) {
      verdictLabel = '🚨 *HIGH RISK / RUG WARNING*'
    } else if (isCaution) {
      verdictLabel = '⚠️ *CAUTION*'
    } else {
      verdictLabel = '✅ *PASSED SECURITY CHECKS*'
    }

    const lines = [
      '🛡 *Token Security Audit*',
      '',
      `${tokenDisplay} · \`${shortAddr}\``,
      `Chain: *${isSolana ? 'Solana' : 'EVM'}*`,
      '',
      `Verdict: ${verdictLabel}`,
      '',
      `• Risk Level: *${audit.riskLevel}/3* (${(audit.riskLabel || 'N/A').toUpperCase()})`,
      `• Mint Authority: *${audit.canMint ? 'Enabled ⚠️' : 'Disabled ✅'}*`,
      `• Freeze Authority: *${audit.canFreeze ? 'Enabled 🚨' : 'Disabled ✅'}*`,
      `• Top 10 Holders: *${(audit.top10HolderPercent * 100).toFixed(1)}%*`,
      `• LP Locked: *${audit.lpLockedPercent >= 0 ? `${(audit.lpLockedPercent * 100).toFixed(1)}%` : 'Unknown'}*`,
      `• Buy / Sell Tax: *${(audit.buyTax * 100).toFixed(1)}% / ${(audit.sellTax * 100).toFixed(1)}%*`,
    ]

    if (audit.isHoneypot) {
      lines.push('• Honeypot: *🚨 YES*')
    }

    lines.push('')
    if (isSolana) {
      lines.push(`🔗 [RugCheck](https://rugcheck.xyz/tokens/${contract}) · [DexScreener](https://dexscreener.com/solana/${contract})`)
    } else {
      lines.push(`🔗 [DexScreener](https://dexscreener.com/ethereum/${contract})`)
    }

    return lines.join('\n')
  } catch (err) {
    return `❌ Failed to audit token: ${(err as Error).message || 'Unknown error'}`
  }
}

export async function formatTopMeme(): Promise<string> {
  try {
    let tokens: Array<Record<string, unknown>> = []
    const d = await fetchApi<{ tokens?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
      '/api/v1/meme/leaderboard?limit=5',
    )
    if (d) {
      if (Array.isArray(d)) {
        tokens = d
      } else if (Array.isArray(d.tokens)) {
        tokens = d.tokens
      }
    }
    if (!tokens.length) {
      const fallback = await fetchApi<Array<Record<string, unknown>>>('/api/v1/tokens')
      if (fallback?.length) {
        tokens = fallback
      }
    }
    if (!tokens.length) {
      return '❌ No trending meme tokens available right now.'
    }

    const lines = ['🔥 *Top Trending Tokens*', '']
    for (const t of tokens.slice(0, 5)) {
      const sym = String(t.symbol ?? '?').replace(/[*_`[\]()]/g, '').toUpperCase()
      const price = typeof t.price === 'number' ? t.price : parseFloat(String(t.price ?? 0))
      const changeRaw = typeof t.change24h === 'number' ? t.change24h : parseFloat(String(t.change24h ?? 0))
      const changePct = Math.abs(changeRaw) <= 1 && changeRaw !== 0 ? changeRaw * 100 : changeRaw
      const vol = typeof t.volume24h === 'number' ? t.volume24h : parseFloat(String(t.volume24h ?? 0))
      const mcap = typeof t.marketCap === 'number' ? t.marketCap : parseFloat(String(t.marketCap ?? 0))
      const arrow = changeRaw >= 0 ? '🟢' : '🔴'
      const statParts: string[] = []
      if (mcap > 0) statParts.push(`MCap: ${fmtUsd(mcap)}`)
      if (vol > 0) statParts.push(`Vol: ${fmtUsd(vol)}`)
      const stat = statParts.length ? ` · ${statParts.join(' · ')}` : ''
      lines.push(`${arrow} *${sym}* ${fmtPrice(price)} (${changeRaw >= 0 ? '+' : ''}${changePct.toFixed(2)}%)${stat}`)
    }
    return lines.join('\n')
  } catch (err) {
    return `❌ Failed to fetch top tokens: ${(err as Error).message || 'Unknown error'}`
  }
}

export async function formatSniperScan(): Promise<string> {
  try {
    let entries: Array<Record<string, unknown>> = []
    let lastScan: {
      at: string
      scanned: number
      screened: number
      watchlisted: number
      rejected: number
      delivered: number
      errors: string[]
    } | null = null
    let counts: Record<string, number> | undefined

    const d = await fetchApi<{
      entries?: Array<Record<string, unknown>>
      lastScan?: {
        at: string
        scanned: number
        screened: number
        watchlisted: number
        rejected: number
        delivered: number
        errors: string[]
      } | null
      counts?: Record<string, number>
    }>('/api/v1/meme/sniper/history')

    if (d && (d.entries || d.lastScan)) {
      entries = d.entries ?? []
      lastScan = d.lastScan ?? null
      counts = d.counts
    } else {
      try {
        const log = readSniperLog()
        entries = (log.entries ?? []) as unknown as Array<Record<string, unknown>>
        lastScan = log.lastScan ?? null
        counts = sniperLogCounts(log)
      } catch {
        // fallback if log module fails
      }
    }

    if (!entries.length && !lastScan) {
      return '🎯 *Sniper Radar Status*\n\nNo recent scan activity recorded. Automated scans evaluate meme liquidity pools periodically.'
    }

    const lines = ['🎯 *Meme Sniper Radar*', '']
    if (lastScan) {
      const scanTime = lastScan.at ? new Date(lastScan.at).toLocaleTimeString() : 'Recent'
      lines.push(`*Last Scan:* ${scanTime}`)
      lines.push(`• Scanned: *${lastScan.scanned}* · Screened: *${lastScan.screened}*`)
      lines.push(`• Watchlisted: *${lastScan.watchlisted}* · Rejected: *${lastScan.rejected}*`)
      if (lastScan.delivered > 0) {
        lines.push(`• Alerts Delivered: *${lastScan.delivered}*`)
      }
      lines.push('')
    } else if (counts) {
      const watchlisted = counts.WATCHLIST ?? counts.watchlisted ?? 0
      const rejected = counts.REJECT ?? counts.rejected ?? 0
      const total = counts.total ?? 0
      lines.push(`*Activity Totals:* ${total} evaluated (${watchlisted} watchlisted · ${rejected} rejected)`)
      lines.push('')
    }

    if (entries.length > 0) {
      lines.push('*Latest Evaluated Tokens:*')
      for (const e of entries.slice(0, 5)) {
        const sym = String(e.ticker ?? 'UNKNOWN').replace(/[*_`[\]()]/g, '').toUpperCase()
        const contract = String(e.contract ?? '')
        const shortAddr = contract.length > 8 ? `${contract.slice(0, 4)}...${contract.slice(-4)}` : contract || '?'
        const status = String(e.status ?? 'UNKNOWN')
        const emoji = status === 'WATCHLIST' ? '🟢' : status === 'REJECT' ? '🔴' : '⚪'
        const market = e.market && typeof e.market === 'object' ? e.market as Record<string, unknown> : null
        const marketCapUsd = market?.marketCapUsd
        const mc = typeof marketCapUsd === 'number' && Number.isFinite(marketCapUsd) && marketCapUsd > 0
          ? ` · ${fmtUsd(marketCapUsd)}`
          : ''
        lines.push(`${emoji} *${sym}* (\`${shortAddr}\`) — ${status}${mc}`)
        const rejections = Array.isArray(e.rejections) ? e.rejections : []
        if (status === 'REJECT' && rejections.length) {
          const reasonText = String(rejections[0]).replace(/[*_`[\]()]/g, '')
          lines.push(`   └ _${reasonText.slice(0, 50)}_`)
        }
      }
    }

    return lines.join('\n')
  } catch (err) {
    return `❌ Failed to fetch sniper scan: ${(err as Error).message || 'Unknown error'}`
  }
}
