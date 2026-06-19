// ─────────────────────────────────────────────────────────────
// Module: GitHub API
// sourceType: public-api
// Endpoint: api.github.com
// Coverage: Developer activity, repo stats, commits, stars — no key (5000/hr)
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../types'
import { TTL } from '../types'
import { cachedFetch } from '../fetch-with-cache'

const BASE = 'https://api.github.com'

async function ghFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': '1AI-Nexus/1.0',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function fetchGitHub(params: FetchParams): Promise<unknown> {
  const action = (params.action as string) ?? 'trending'

  switch (action) {
    case 'trending': {
      // GitHub search API for trending repos
      const q = (params.q as string) ?? 'stars:>1000 created:>2026-06-01'
      return ghFetch<unknown>(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`)
    }
    case 'repo': {
      const owner = params.owner as string
      const repo = params.repo as string
      return ghFetch<unknown>(`/repos/${owner}/${repo}`)
    }
    case 'commits': {
      const owner = params.owner as string
      const repo = params.repo as string
      return ghFetch<unknown>(`/repos/${owner}/${repo}/commits?per_page=30`)
    }
    case 'activity': {
      // Developer activity for a crypto project
      const owner = params.owner as string
      const repo = params.repo as string
      const [commits, issues, prs] = await Promise.allSettled([
        ghFetch<Array<Record<string, unknown>>>(`/repos/${owner}/${repo}/commits?per_page=10`),
        ghFetch<{ items: Array<Record<string, unknown>> }>(`/search/issues?q=repo:${owner}/${repo}+is:issue+created:>2026-06-01`),
        ghFetch<{ items: Array<Record<string, unknown>> }>(`/search/issues?q=repo:${owner}/${repo}+is:pr+created:>2026-06-01`),
      ])
      return {
        recentCommits: commits.status === 'fulfilled' ? commits.value.length : 0,
        openIssues: issues.status === 'fulfilled' ? issues.value.items.length : 0,
        openPRs: prs.status === 'fulfilled' ? prs.value.items.length : 0,
      }
    }
    default:
      throw new Error(`GitHub: unknown action ${action}`)
  }
}

const githubModule: DataModule = {
  id: 'github',
  name: 'GitHub API',
  category: 'sentiment',
  sourceType: 'public-api',
  provenance: {
    describesItself: 'GitHub API — developer activity, repo stats, commits, stars, issues for crypto projects',
    fragility: 'stable',
    lastVerified: '2026-06-20',
    toleratesAbsence: true,
  },
  isEnabled: () => true,
  async healthCheck(): Promise<ModuleHealth> {
    try {
      await ghFetch('/rate_limit')
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    } catch (e) {
      return { status: 'offline', lastChecked: new Date(), failureCount: 1, notes: String(e) }
    }
  },
  async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
    return cachedFetch<T>('github', params, TTL.SENTIMENT, () => fetchGitHub(params) as Promise<T>)
  },
}

export default githubModule
