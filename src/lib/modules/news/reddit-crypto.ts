// ─────────────────────────────────────────────────────────────
// Module: Reddit Crypto
// sourceType: public-api
// Endpoint: reddit.com JSON API (no key needed)
// Coverage: Hot/top posts from crypto subreddits
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const SUBREDDITS = ['CryptoCurrency', 'Bitcoin', 'ethereum', 'solana']

async function fetchRedditSub(sub: string, sort: string, limit: number) {
  const res = await fetch(`https://www.reddit.com/r/${sub}/${sort}.json?limit=${limit}&t=day`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'NexusBot/1.0',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Reddit ${res.status}: r/${sub}`)
  const json = await res.json() as { data: { children: Array<{ data: Record<string, unknown> }> } }
  return json.data.children.map(c => ({
    title: c.data.title,
    url: `https://reddit.com${c.data.permalink}`,
    score: c.data.score,
    comments: c.data.num_comments,
    author: c.data.author,
    subreddit: c.data.subreddit,
    created: c.data.created_utc,
    thumbnail: c.data.thumbnail,
    selftext: (c.data.selftext as string)?.slice(0, 300),
  }))
}

async function fetchReddit(params: FetchParams): Promise<unknown> {
  const sub = (params.sub as string) ?? 'CryptoCurrency'
  const sort = (params.sort as string) ?? 'hot'
  const limit = (params.limit as number) ?? 25

  if (sub === 'all') {
    const results = await Promise.allSettled(
      SUBREDDITS.map(s => fetchRedditSub(s, sort, Math.ceil(limit / SUBREDDITS.length)))
    )
    return results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchRedditSub>>> => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .sort((a, b) => (b.score as number) - (a.score as number))
      .slice(0, limit)
  }

  return fetchRedditSub(sub, sort, limit)
}

const redditCryptoModule: DataModule = {
  id: 'reddit-crypto',
  name: 'Reddit Crypto',
  category: 'news',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'Reddit JSON API — hot/top posts from r/CryptoCurrency, r/Bitcoin, r/ethereum, r/solana',
    fragility: 'stable',
    lastVerified: '2026-06-19',
    toleratesAbsence: true,
  },

  isEnabled: () => true,

  async healthCheck(): Promise<ModuleHealth> {
    try {
      await fetchRedditSub('CryptoCurrency', 'hot', 1)
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },

  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>(
      'reddit-crypto',
      params,
      TTL.NEWS,
      () => fetchReddit(params) as Promise<T>,
    )
  },
}

export default redditCryptoModule
