// ─────────────────────────────────────────────────────────────
// GitHub Developer Velocity — stars, forks, commits for crypto repos
// sourceType: public-api
// Endpoint: api.github.com — 5000 req/hr unauthenticated
// No API keys required
// ─────────────────────────────────────────────────────────────

import { prisma } from '../../db'

const BASE = 'https://api.github.com'

export interface RepoVelocity {
  repo: string
  owner: string
  stars: number
  forks: number
  openIssues: number
  weeklyCommits: number        // last week's commits
  commitHistory: number[]      // last 4 weeks of commits
  contributorCount: number     // from contributors endpoint (approx)
}

export interface GitHubVelocitySnapshot {
  repos: RepoVelocity[]
  totals: {
    totalStars: number
    totalForks: number
    totalWeeklyCommits: number
    avgWeeklyCommits: number
  }
  timestamp: string
}

// Top crypto repos to track
const TRACKED_REPOS = [
  { owner: 'bitcoin', repo: 'bitcoin', label: 'bitcoin/bitcoin' },
  { owner: 'ethereum', repo: 'go-ethereum', label: 'ethereum/go-ethereum' },
  { owner: 'solana-labs', repo: 'solana', label: 'solana-labs/solana' },
  { owner: 'Uniswap', repo: 'v3-core', label: 'Uniswap/v3-core' },
  { owner: 'aave', repo: 'aave-v3-origin', label: 'aave/aave-v3-origin' },
  { owner: 'MetaMask', repo: 'metamask-extension', label: 'MetaMask/metamask-extension' },
] as const

async function ghFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': '1AI-Nexus/1.0',
  }
  // Use GITHUB_TOKEN if available to increase rate limit
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

interface GitHubRepoResponse {
  stargazers_count: number
  forks_count: number
  open_issues_count: number
}

interface CommitWeek {
  total: number
  week: number // unix timestamp
}

async function fetchRepoVelocity(owner: string, repo: string): Promise<RepoVelocity> {
  const [repoData, commitActivity] = await Promise.allSettled([
    ghFetch<GitHubRepoResponse>(`/repos/${owner}/${repo}`),
    ghFetch<CommitWeek[]>(`/repos/${owner}/${repo}/stats/commit_activity`),
  ])

  const repoInfo = repoData.status === 'fulfilled' ? repoData.value : null
  const commitWeeks = commitActivity.status === 'fulfilled' ? commitActivity.value : []

  // Take last 4 weeks of commit data
  const last4Weeks = Array.isArray(commitWeeks) ? commitWeeks.slice(-4) : []
  const weeklyCommits = last4Weeks.length > 0 ? last4Weeks[last4Weeks.length - 1].total : 0
  const commitHistory = last4Weeks.map(w => w.total)

  // Contributor count approximation — GitHub API returns 30 per page by default
  // We use Link header to get total, but for simplicity we'll estimate from activity
  let contributorCount = 0
  try {
    const contribRes = await fetch(`${BASE}/repos/${owner}/${repo}/contributors?per_page=1&anon=false`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': '1AI-Nexus/1.0',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    })
    // GitHub returns Link header with last page number = total count
    const link = contribRes.headers.get('Link')
    if (link) {
      const match = link.match(/page=(\d+)>; rel="last"/)
      if (match) contributorCount = parseInt(match[1], 10)
    }
  } catch {
    // Graceful degradation
  }

  return {
    repo: `${owner}/${repo}`,
    owner,
    stars: repoInfo?.stargazers_count ?? 0,
    forks: repoInfo?.forks_count ?? 0,
    openIssues: repoInfo?.open_issues_count ?? 0,
    weeklyCommits,
    commitHistory,
    contributorCount,
  }
}

/**
 * Fetch velocity for all tracked repos in parallel.
 * Returns structured snapshot with per-repo and aggregate data.
 */
export async function fetchGitHubVelocity(): Promise<GitHubVelocitySnapshot> {
  const results = await Promise.allSettled(
    TRACKED_REPOS.map(r => fetchRepoVelocity(r.owner, r.repo))
  )

  const repos = results
    .filter((r): r is PromiseFulfilledResult<RepoVelocity> => r.status === 'fulfilled')
    .map(r => r.value)

  // Persist snapshots for historical tracking
  await persistSnapshots(repos)

  const totals = repos.reduce(
    (acc, r) => ({
      totalStars: acc.totalStars + r.stars,
      totalForks: acc.totalForks + r.forks,
      totalWeeklyCommits: acc.totalWeeklyCommits + r.weeklyCommits,
      avgWeeklyCommits: 0, // computed after
    }),
    { totalStars: 0, totalForks: 0, totalWeeklyCommits: 0, avgWeeklyCommits: 0 }
  )
  totals.avgWeeklyCommits = repos.length > 0 ? totals.totalWeeklyCommits / repos.length : 0

  return {
    repos,
    totals,
    timestamp: new Date().toISOString(),
  }
}

async function persistSnapshots(repos: RepoVelocity[]): Promise<void> {
  try {
    const records = repos.flatMap(r => [
      { source: 'github', metric: 'stars', repo: r.repo, value: r.stars },
      { source: 'github', metric: 'forks', repo: r.repo, value: r.forks },
      { source: 'github', metric: 'commits', repo: r.repo, value: r.weeklyCommits },
      { source: 'github', metric: 'contributors', repo: r.repo, value: r.contributorCount },
      { source: 'github', metric: 'open_issues', repo: r.repo, value: r.openIssues },
    ])
    await prisma.attentionSnapshot.createMany({ data: records })
  } catch (e) {
    console.error('[github-velocity] persist failed:', (e as Error).message)
  }
}

/**
 * Get historical AttentionSnapshot data for a given source/metric.
 * Used by the API route for time-series views.
 */
export async function getAttentionHistory(
  source: string,
  metric: string,
  repo?: string,
  hours = 168 // 7 days default
): Promise<Array<{ value: number; timestamp: Date; repo: string | null }>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)
  const where: Record<string, unknown> = { source, metric, timestamp: { gte: since } }
  if (repo) where.repo = repo

  return prisma.attentionSnapshot.findMany({
    where: { source, metric, timestamp: { gte: since }, ...(repo ? { repo } : {}) },
    orderBy: { timestamp: 'asc' },
    select: { value: true, timestamp: true, repo: true },
  })
}
