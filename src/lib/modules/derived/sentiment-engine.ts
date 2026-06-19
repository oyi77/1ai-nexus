// ─────────────────────────────────────────────────────────────
// Sentiment Scoring Engine
// Scores news articles using keyword-based NLP (no external API)
// ponytail: keyword scoring, upgrade to LLM-based when Anthropic key available
// ─────────────────────────────────────────────────────────────

export interface SentimentScore {
  score: number        // -1.0 (bearish) to +1.0 (bullish)
  label: 'bullish' | 'bearish' | 'neutral'
  confidence: number   // 0.0 to 1.0
  signals: string[]    // matched keywords
}

const BULLISH_KEYWORDS = [
  'surge', 'rally', 'breakout', 'bullish', 'all-time high', 'ath', 'pump', 'moon',
  'adoption', 'partnership', 'launch', 'approval', 'etf approved', 'institutional',
  'accumulation', 'buying', 'upgrade', 'milestone', 'record high', 'growth',
  'revenue increase', 'profit', 'outperform', 'beat expectations', 'positive',
  'recovery', 'rebound', 'uptrend', 'support holding', 'demand increasing',
  'supply squeeze', 'halving', 'deflationary', 'burning', 'staking increase',
]

const BEARISH_KEYWORDS = [
  'crash', 'dump', 'bearish', 'sell-off', 'selloff', 'decline', 'drop', 'plunge',
  'hack', 'exploit', 'rug pull', 'scam', 'fraud', 'sec lawsuit', 'regulation',
  'ban', 'crackdown', 'warning', 'risk', 'bubble', 'overvalued', 'downgrade',
  'bankruptcy', 'insolvency', 'liquidation', 'margin call', 'fear', 'panic',
  'capitulation', 'death cross', 'support broken', 'resistance rejection',
  'whale selling', 'exchange outflow', 'funding negative', 'contango',
]

const ASSET_KEYWORDS: Record<string, string[]> = {
  'BTC': ['bitcoin', 'btc', 'satoshi', 'halving', 'digital gold'],
  'ETH': ['ethereum', 'eth', 'vitalik', 'merge', 'staking', 'eip'],
  'SOL': ['solana', 'sol', 'phantom', 'raydium', 'jupiter'],
  'BNB': ['binance', 'bnb', 'cz', 'changpeng'],
  'XRP': ['ripple', 'xrp', 'garlinghouse'],
  'ADA': ['cardano', 'ada', 'hoskinson'],
  'DOGE': ['dogecoin', 'doge', 'elon', 'musk'],
  'LINK': ['chainlink', 'link', 'oracle'],
  'AVAX': ['avalanche', 'avax', 'subnet'],
  'DOT': ['polkadot', 'dot', 'parachain'],
  'UNI': ['uniswap', 'uni', 'dex'],
  'AAVE': ['aave', 'lending', 'defi lending'],
  'MATIC': ['polygon', 'matic', 'zk'],
  'ARB': ['arbitrum', 'arb', 'l2', 'layer 2'],
  'OP': ['optimism', 'op', 'superchain'],
}

export function scoreSentiment(text: string): SentimentScore {
  const lower = text.toLowerCase()
  const signals: string[] = []
  let bullCount = 0
  let bearCount = 0

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) {
      bullCount++
      signals.push(`+${kw}`)
    }
  }

  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) {
      bearCount++
      signals.push(`-${kw}`)
    }
  }

  const total = bullCount + bearCount
  if (total === 0) return { score: 0, label: 'neutral', confidence: 0.1, signals: [] }

  const score = (bullCount - bearCount) / total
  const confidence = Math.min(1, total * 0.15) // More keywords = more confidence

  return {
    score,
    label: score > 0.1 ? 'bullish' : score < -0.1 ? 'bearish' : 'neutral',
    confidence,
    signals: signals.slice(0, 10), // Cap at 10 signals
  }
}

export function detectAssets(text: string): string[] {
  const lower = text.toLowerCase()
  const detected: string[] = []

  for (const [symbol, keywords] of Object.entries(ASSET_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      detected.push(symbol)
    }
  }

  return detected
}
