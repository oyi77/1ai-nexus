// ─────────────────────────────────────────────────────────────
// Stockbit Realtime Provider — RE'd, FREE, KEYLESS IDX quotes.
//
// Source: https://stockbit.com/symbol/{CODE} embeds a per-symbol
// quote object inside its Next.js RSC payload (verified
// logged-out, pre/post market). Extracted fields:
//   price, previous, percentage, volume,
//   orderbook.bid/.offer {price,volume}   (top of book)
//   sector/sub_sector (Indonesian IC taxonomy)
//   updated ISO timestamp, market_hour.status
//
// Ladder position: DEFAULT realtime source. The env-keyed iTick
// adapter is only consulted first when ITICK_API_KEY exists — and
// iTick's free tier EXCLUDES IDX (HK/US/A-shares only), so this
// free path is the production default.
//
// PARSING NOTES:
//  - RSC payloads may nest JSON with \" escapes → normalize once.
//  - Anchor = the "orderbook":{"bid" block whose window contains
//    "symbol":"CODE" (the page lists many other symbols earlier —
//    watchlists/movers — so naive first-"symbol" anchoring fails).
//  - The orderbook block itself carries a "price" key (top-of-book
//    bid); bind previous↔price adjacency instead, with ask fallback.
// ─────────────────────────────────────────────────────────────

const BASE_URL = 'https://stockbit.com/symbol'
const CACHE_TTL_MS = 5_000 // be polite: one upstream page hit / 5s / symbol

export interface StockbitQuote {
  symbol: string
  name?: string
  price: number
  previous: number
  changePct: number
  volume: number | null
  bid?: { price: number; volume: number }
  ask?: { price: number; volume: number }
  sector?: string
  subSector?: string
  marketStatus?: string
  updatedAt?: string
  sessionTime?: string
  fetchedAt: string
}

interface CacheEntry {
  at: number
  quote: StockbitQuote
}

const cache = new Map<string, CacheEntry>()

const num = (v: string | undefined): number => {
  const n = Number.parseFloat(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : NaN
}

function extractField(window_: string, key: string): string | undefined {
  const m = window_.match(new RegExp(`"${key}":"([^"]*)"`))
  return m?.[1]
}

/** Fetch + parse the embedded quote object for an IDX ticker. */
export async function getStockbitQuote(symbolInput: string): Promise<StockbitQuote> {
  const symbol = symbolInput.replace('.JK', '').toUpperCase()
  const cached = cache.get(symbol)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.quote

  const res = await fetch(`${BASE_URL}/${symbol}`, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  })
  if (!res.ok) throw new Error(`stockbit HTTP ${res.status}`)
  const html = await res.text()

  // RSC payloads sometimes nest JSON with \" escapes; normalize once
  // so every downstream regex sees plain quotes.
  const normalized = html.replace(/\\"/g, '"')

  // Anchor: the orderbook block belonging to THIS symbol. Pages embed
  // many symbols (watchlists/movers), so require the code inside the
  // same window as the orderbook.
  let win = ''
  for (const m of normalized.matchAll(/"orderbook":\{"bid"/g)) {
    const start = Math.max(0, (m.index ?? 0) - 2500)
    const candidate = normalized.slice(start, (m.index ?? 0) + 4500)
    if (candidate.includes(`"symbol":"${symbol}"`)) {
      win = candidate
      break
    }
  }
  if (!win) throw new Error(`quote object not found for ${symbol} (page layout changed?)`)

  // previous↔price adjacency first; orderbook "price" must not win.
  const pctMatch = win.match(/"percentage":(-?\d+(?:\.\d+)?)/)
  const pctStr = pctMatch?.[1]
  const pctIdx = pctMatch?.index ?? -1
  const beforePct = pctIdx >= 0 ? win.slice(0, pctIdx) : ''

  let prevStr: string | undefined
  let priceStr: string | undefined
  const pair =
    beforePct.match(/"previous":"([\d.,]+)","price":"([\d.,]+)"/) ??
    win.match(/"previous":"([\d.,]+)","price":"([\d.,]+)"/)
  if (pair) {
    prevStr = pair[1]
    priceStr = pair[2]
  }

  const bidPrice = win.match(/"bid":\{"price":"([\d.]+)"/)?.[1]
  const bidVol = win.match(/"bid":\{"price":"[\d.]+","volume":"([\d.]+)"/)?.[1]
  const askPrice = win.match(/"offer":\{"price":"([\d.]+)"/)?.[1]
  const askVol = win.match(/"offer":\{"price":"[\d.]+","volume":"([\d.]+)"/)?.[1]

  if (!Number.isFinite(num(priceStr)) && askPrice) priceStr = askPrice

  const price = num(priceStr)
  if (!Number.isFinite(price)) throw new Error(`no parsable price for ${symbol}`)

  const updatedAtMatches = [...win.matchAll(/"updated":"(20[^"]+)"/g)].map((m) => m[1])
  const updatedAt = updatedAtMatches.length > 0 ? updatedAtMatches[updatedAtMatches.length - 1] : undefined

  const marketStatus = win.match(/"market_hour":\{"status":"([a-z_]+)"/)?.[1]

  const quote: StockbitQuote = {
    symbol: `${symbol}.JK`,
    name: extractField(win, 'name'),
    price,
    previous: num(prevStr),
    changePct: num(pctStr),
    // "volume" first appears inside orderbook.bid; the session volume
    // sits after percentage/previous/price — scope the search there.
    volume: (() => {
      const afterPct = pctIdx >= 0 ? win.slice(pctIdx) : win
      const v = afterPct.match(/"volume":"([\d.]+)"/)?.[1]
      return v ? num(v) : null
    })(),
    bid: bidPrice ? { price: num(bidPrice), volume: num(bidVol) } : undefined,
    ask: askPrice ? { price: num(askPrice), volume: num(askVol) } : undefined,
    sector: extractField(win, 'sector'),
    subSector: extractField(win, 'sub_sector'),
    marketStatus,
    updatedAt,
    sessionTime: extractField(win, 'time'),
    fetchedAt: new Date().toISOString(),
  }

  cache.set(symbol, { at: Date.now(), quote })
  return quote
}
