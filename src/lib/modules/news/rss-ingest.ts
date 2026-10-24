import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { loadFeeds, type FeedConfig } from '@/lib/feed-config'
import { parseRssItems, type FeedCategory } from '@/lib/modules/news/rss/engine'

export interface ParsedFeedArticle {
  sourceId: string
  title: string
  summary: string | null
  url: string
  publishedAt: Date
  assets: string[]
  sentiment: 'bullish' | 'bearish' | 'neutral'
  category: string
}

export interface IngestOptions {
  feeds?: FeedConfig[]
  concurrency?: number
  maxItemsPerFeed?: number
  timeoutMs?: number
  batchSize?: number
}

export interface IngestResult {
  totalFeeds: number
  successfulFeeds: number
  failedFeeds: number
  totalArticlesFetched: number
  newArticlesPersisted: number
  durationMs: number
}

const ASSET_PATTERNS: Array<{ symbol: string; regex: RegExp }> = [
  { symbol: 'BTC', regex: /\b(?:bitcoin|btc)\b/i },
  { symbol: 'ETH', regex: /\b(?:ethereum|eth|ether)\b/i },
  { symbol: 'SOL', regex: /\b(?:solana|sol)\b/i },
  { symbol: 'BNB', regex: /\b(?:binance(?:\s*coin)?|bnb)\b/i },
  { symbol: 'XRP', regex: /\b(?:ripple|xrp)\b/i },
  { symbol: 'ADA', regex: /\b(?:cardano|ada)\b/i },
  { symbol: 'DOGE', regex: /\b(?:dogecoin|doge)\b/i },
  { symbol: 'AVAX', regex: /\b(?:avalanche|avax)\b/i },
  { symbol: 'LINK', regex: /\b(?:chainlink|link)\b/i },
  { symbol: 'DOT', regex: /\b(?:polkadot|dot)\b/i },
  { symbol: 'SUI', regex: /\b(?:sui)\b/i },
  { symbol: 'NEAR', regex: /\b(?:near(?:\s*protocol)?)\b/i },
  { symbol: 'APT', regex: /\b(?:aptos|apt)\b/i },
  { symbol: 'ARB', regex: /\b(?:arbitrum|arb)\b/i },
  { symbol: 'OP', regex: /\b(?:optimism|op)\b/i },
  { symbol: 'PEPE', regex: /\b(?:pepe)\b/i },
  { symbol: 'WIF', regex: /\b(?:dogwifhat|wif)\b/i },
  { symbol: 'BONK', regex: /\b(?:bonk)\b/i },
  { symbol: 'USDT', regex: /\b(?:tether|usdt)\b/i },
  { symbol: 'USDC', regex: /\b(?:usd\s*coin|usdc)\b/i },
  { symbol: 'BBCA', regex: /\b(?:bbca|bank\s*central\s*asia)\b/i },
  { symbol: 'BBRI', regex: /\b(?:bbri|bank\s*rakyat\s*indonesia)\b/i },
  { symbol: 'BMRI', regex: /\b(?:bmri|bank\s*mandiri)\b/i },
  { symbol: 'BBNI', regex: /\b(?:bbni|bank\s*negara\s*indonesia)\b/i },
  { symbol: 'ASII', regex: /\b(?:asii|astra\s*international)\b/i },
  { symbol: 'TLKM', regex: /\b(?:tlkm|telkom(?:\s*indonesia)?)\b/i },
  { symbol: 'UNVR', regex: /\b(?:unvr|unilever(?:\s*indonesia)?)\b/i },
  { symbol: 'ICBP', regex: /\b(?:icbp|indofood\s*cbp)\b/i },
  { symbol: 'INDF', regex: /\b(?:indf|indofood)\b/i },
  { symbol: 'GOTO', regex: /\b(?:goto|gojek|tokopedia)\b/i },
  { symbol: 'BREN', regex: /\b(?:bren|barito\s*renewables)\b/i },
  { symbol: 'AMMN', regex: /\b(?:ammn|amman\s*mineral)\b/i },
  { symbol: 'TPIA', regex: /\b(?:tpia|chandra\s*asri)\b/i },
  { symbol: 'PGAS', regex: /\b(?:pgas|perusahaan\s*gas\s*negara)\b/i },
  { symbol: 'ANTM', regex: /\b(?:antm|aneka\s*tambang)\b/i },
  { symbol: 'INCO', regex: /\b(?:inco|vale\s*indonesia)\b/i },
  { symbol: 'ADRO', regex: /\b(?:adro|adaro(?:\s*energy)?)\b/i },
  { symbol: 'PTBA', regex: /\b(?:ptba|bukit\s*asam)\b/i },
  { symbol: 'KLBF', regex: /\b(?:klbf|kalbe\s*farma)\b/i },
  { symbol: 'BRIS', regex: /\b(?:bris|bank\s*syariah\s*indonesia)\b/i },
  { symbol: 'MEDC', regex: /\b(?:medc|medco(?:\s*energi)?)\b/i },
  { symbol: 'CPIN', regex: /\b(?:cpin|charoen\s*pokphand)\b/i },
  { symbol: 'IHSG', regex: /\b(?:ihsg|indeks\s*harga\s*saham\s*gabungan)\b/i },
  { symbol: 'NVDA', regex: /\b(?:nvidia|nvda)\b/i },
  { symbol: 'AAPL', regex: /\b(?:apple|aapl)\b/i },
  { symbol: 'MSFT', regex: /\b(?:microsoft|msft)\b/i },
  { symbol: 'GOOGL', regex: /\b(?:google|alphabet|googl|goog)\b/i },
  { symbol: 'AMZN', regex: /\b(?:amazon|amzn)\b/i },
  { symbol: 'META', regex: /\b(?:meta\s*platforms|meta)\b/i },
  { symbol: 'TSLA', regex: /\b(?:tesla|tsla)\b/i },
  { symbol: 'SPY', regex: /\b(?:s&p\s*500|s&p500|spy)\b/i },
  { symbol: 'QQQ', regex: /\b(?:nasdaq(?:\s*100)?|qqq)\b/i },
  { symbol: 'GOLD', regex: /\b(?:gold(?:\s*price)?|emas(?:\s*antam)?|xau)\b/i },
  { symbol: 'OIL', regex: /\b(?:crude\s*oil|brent|wti|minyak\s*mentah)\b/i },
  { symbol: 'DXY', regex: /\b(?:dxy|us\s*dollar\s*index)\b/i },
]

const BULLISH_PATTERNS: RegExp[] = [
  /\b(?:rally|rallies|surge|surges|surging|jump|jumps|jumped|gain|gains|gained|climb|climbs|climbing)\b/i,
  /\b(?:record\s+high|all-time\s+high|ath|breakout|break\s+out|bullish|buy|buying|accumulate|accumulation)\b/i,
  /\b(?:profit|profits|profitable|beat|beats|expansion|dividend|dividends|approve|approved|approval)\b/i,
  /\b(?:inflow|inflows|partnership|adoption|rebound|rebounds|upbeat|outpace|outpaces|skyrocket|soar|soars)\b/i,
  /\b(?:melonjak|menguat|naik|cuan|dividen|laba|rekor|pemulihan|positif|pertumbuhan|meningkat)\b/i,
]

const BEARISH_PATTERNS: RegExp[] = [
  /\b(?:crash|crashes|crashing|plunge|plunges|plunged|tumble|tumbles|tumbled|sink|sinks|sinking)\b/i,
  /\b(?:slump|slumps|slumped|drop|drops|dropped|decline|declines|declined|fall|falls|fell|falling)\b/i,
  /\b(?:bearish|sell|selling|selloff|sell-off|liquidation|liquidations|dump|dumps|dumped)\b/i,
  /\b(?:loss|losses|exploit|exploits|exploited|hack|hacks|hacked|scam|scams|fraud|fraudulent)\b/i,
  /\b(?:lawsuit|lawsuits|probe|probes|investigate|investigation|sanction|sanctions|ban|bans|banned)\b/i,
  /\b(?:warning|deficit|bankruptcy|bankrupt|cut|cuts|down|default|defaults)\b/i,
  /\b(?:jatuh|anjlok|melemah|turun|rugi|kerugian|gugatan|diselidiki|sanksi|kejatuhan|bangkrut|negatif)\b/i,
]

export function extractAssetEntities(text: string): string[] {
  if (!text) return []
  const matches: string[] = []
  for (const { symbol, regex } of ASSET_PATTERNS) {
    if (regex.test(text)) {
      matches.push(symbol)
    }
  }
  return Array.from(new Set(matches))
}

export function classifySentimentDirection(text: string): { direction: 'bullish' | 'bearish' | 'neutral'; score: number } {
  if (!text) return { direction: 'neutral', score: 0 }
  let bullHits = 0
  let bearHits = 0

  for (const p of BULLISH_PATTERNS) {
    const m = text.match(new RegExp(p.source, 'gi'))
    if (m) bullHits += m.length
  }
  for (const p of BEARISH_PATTERNS) {
    const m = text.match(new RegExp(p.source, 'gi'))
    if (m) bearHits += m.length
  }

  if (bullHits > bearHits) {
    const score = Number(Math.min(1, 0.4 + (bullHits - bearHits) * 0.15).toFixed(2))
    return { direction: 'bullish', score }
  }
  if (bearHits > bullHits) {
    const score = Number(Math.max(-1, -0.4 - (bearHits - bullHits) * 0.15).toFixed(2))
    return { direction: 'bearish', score }
  }
  return { direction: 'neutral', score: 0 }
}

export async function fetchFeedItems(
  feed: { id: string; url: string; category: string },
  timeoutMs = 8000
): Promise<ParsedFeedArticle[]> {
  try {
    const res = await fetch(feed.url, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml',
        'User-Agent': 'NexusBot/1.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return []
    const xml = await res.text()
    const parsed = parseRssItems(xml, feed.id, feed.category as FeedCategory)

    const articles: ParsedFeedArticle[] = []
    for (const item of parsed) {
      const trimmedUrl = item.link?.trim()
      const trimmedTitle = item.title?.trim()
      if (!trimmedUrl || !trimmedTitle || !trimmedUrl.startsWith('http')) continue

      const d = new Date(item.publishedAt)
      const publishedAt = isNaN(d.getTime()) ? new Date() : d
      const combined = `${trimmedTitle} ${item.summary ?? ''}`
      const assets = extractAssetEntities(combined)
      const { direction } = classifySentimentDirection(combined)

      articles.push({
        sourceId: feed.id,
        title: trimmedTitle,
        summary: item.summary ? item.summary.slice(0, 500) : null,
        url: trimmedUrl,
        publishedAt,
        assets,
        sentiment: direction,
        category: feed.category,
      })
    }
    return articles
  } catch {
    return []
  }
}

async function loadFeedsFallback(): Promise<FeedConfig[]> {
  try {
    const feeds = await loadFeeds()
    if (Array.isArray(feeds) && feeds.length > 0) return feeds
  } catch {}

  try {
    const filePath = path.join(process.cwd(), 'data', 'feeds.json')
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (Array.isArray(raw)) return raw as FeedConfig[]
  } catch {}

  return []
}

export async function ingestRssFeeds(options?: IngestOptions): Promise<IngestResult> {
  const startTime = Date.now()
  const feeds = options?.feeds ?? (await loadFeedsFallback())
  const concurrency = Math.max(1, options?.concurrency ?? 10)
  const maxItemsPerFeed = options?.maxItemsPerFeed ?? 25
  const timeoutMs = options?.timeoutMs ?? 8000
  const batchSize = options?.batchSize ?? 100

  let successfulFeeds = 0
  let failedFeeds = 0
  const allArticles: ParsedFeedArticle[] = []

  for (let i = 0; i < feeds.length; i += concurrency) {
    const chunk = feeds.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      chunk.map(f => fetchFeedItems(f, timeoutMs))
    )

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        successfulFeeds++
        allArticles.push(...r.value.slice(0, maxItemsPerFeed))
      } else {
        failedFeeds++
      }
    }
  }

  const seenUrls = new Set<string>()
  const dedupedArticles: ParsedFeedArticle[] = []
  for (const article of allArticles) {
    if (seenUrls.has(article.url)) continue
    seenUrls.add(article.url)
    dedupedArticles.push(article)
  }

  let newArticlesPersisted = 0
  for (let i = 0; i < dedupedArticles.length; i += batchSize) {
    const batch = dedupedArticles.slice(i, i + batchSize)
    try {
      const res = await prisma.newsArticle.createMany({
        data: batch.map(a => ({
          sourceId: a.sourceId,
          title: a.title,
          summary: a.summary,
          url: a.url,
          publishedAt: a.publishedAt,
          assets: a.assets,
          sentiment: a.sentiment,
          category: a.category,
        })),
        skipDuplicates: true,
      })
      newArticlesPersisted += res.count
    } catch {}
  }

  return {
    totalFeeds: feeds.length,
    successfulFeeds,
    failedFeeds,
    totalArticlesFetched: allArticles.length,
    newArticlesPersisted,
    durationMs: Date.now() - startTime,
  }
}
