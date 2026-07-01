// ─────────────────────────────────────────────────────────────
// Dev Activity Intelligence Module
// Tracks npm/PyPI download trends for crypto/blockchain packages
// Proxy for developer ecosystem growth
// Historical tracking with MoM comparison
// Zero API keys — public npm/PyPI stats APIs
// ─────────────────────────────────────────────────────────────

import { prisma } from '../../db'

export interface PackageStats {
  name: string
  ecosystem: string
  category: 'layer1' | 'defi' | 'tooling' | 'wallet' | 'infra'
  downloads: number
  previousDownloads: number | null
  changeMoM: number | null  // percentage change month-over-month
  period: string
}

export interface EcosystemSummary {
  ecosystem: string
  totalDownloads: number
  previousDownloads: number | null
  changeMoM: number | null
  packageCount: number
  signal: 'growing' | 'stable' | 'declining'
}

export interface DevActivitySnapshot {
  packages: PackageStats[]
  ecosystemSummary: EcosystemSummary[]
  timestamp: string
}

// Crypto/blockchain packages to track
const TRACKED_PACKAGES: Array<{ name: string; ecosystem: string; category: PackageStats['category'] }> = [
  // Ethereum
  { name: 'ethers', ecosystem: 'Ethereum', category: 'tooling' },
  { name: 'viem', ecosystem: 'Ethereum', category: 'tooling' },
  { name: 'wagmi', ecosystem: 'Ethereum', category: 'wallet' },
  { name: 'hardhat', ecosystem: 'Ethereum', category: 'tooling' },
  { name: '@ethereumjs/common', ecosystem: 'Ethereum', category: 'infra' },
  { name: 'web3', ecosystem: 'Ethereum', category: 'tooling' },
  // Solana
  { name: '@solana/web3.js', ecosystem: 'Solana', category: 'tooling' },
  { name: '@coral-xyz/anchor', ecosystem: 'Solana', category: 'tooling' },
  { name: '@metaplex-foundation/umi', ecosystem: 'Solana', category: 'infra' },
  // Polkadot
  { name: '@polkadot/api', ecosystem: 'Polkadot', category: 'tooling' },
  // Cosmos
  { name: '@cosmjs/stargate', ecosystem: 'Cosmos', category: 'tooling' },
  // DeFi
  { name: '@uniswap/v3-sdk', ecosystem: 'DeFi', category: 'defi' },
  { name: '@aave/contract-helpers', ecosystem: 'DeFi', category: 'defi' },
  // Wallet
  { name: '@rainbow-me/rainbowkit', ecosystem: 'Wallet', category: 'wallet' },
  { name: '@web3modal/ethers', ecosystem: 'Wallet', category: 'wallet' },
  // Indexing
  { name: '@subsquid/squid-sdk', ecosystem: 'Indexing', category: 'infra' },
  { name: 'subgraph', ecosystem: 'Indexing', category: 'infra' },
]

async function fetchNpmDownloads(pkgName: string): Promise<number> {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkgName)}`, {
      headers: { 'User-Agent': 'NEXUS-T/1.0' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return 0
    const data = await res.json() as { downloads?: number }
    return data.downloads ?? 0
  } catch { return 0 }
}

async function getPreviousDownloads(packageName: string): Promise<number | null> {
  try {
    const prev = await prisma.devActivitySnapshot.findFirst({
      where: { package: packageName },
      orderBy: { timestamp: 'desc' },
      skip: 1, // skip the most recent (current), get the one before
      select: { downloads: true },
    })
    return prev?.downloads ?? null
  } catch { return null }
}

function computeMoMChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

export async function fetchDevActivity(): Promise<DevActivitySnapshot> {
  // Fetch all npm packages in parallel
  const results = await Promise.allSettled(
    TRACKED_PACKAGES.map(async (pkg) => {
      const downloads = await fetchNpmDownloads(pkg.name)
      const previousDownloads = await getPreviousDownloads(pkg.name)
      const changeMoM = computeMoMChange(downloads, previousDownloads)
      return {
        ...pkg,
        downloads,
        previousDownloads,
        changeMoM,
        period: 'last-month',
      } as PackageStats
    })
  )

  const packages = results
    .filter((r): r is PromiseFulfilledResult<PackageStats> => r.status === 'fulfilled' && r.value.downloads > 0)
    .map(r => r.value)
    .sort((a, b) => b.downloads - a.downloads)

  // Persist current snapshot (fire-and-forget)
  for (const pkg of packages) {
    prisma.devActivitySnapshot.create({
      data: {
        package: pkg.name,
        ecosystem: pkg.ecosystem,
        category: pkg.category,
        downloads: pkg.downloads,
        period: pkg.period,
      },
    }).catch(() => {})
  }

  // Aggregate by ecosystem
  const ecosystemMap = new Map<string, { current: number; previous: number | null; count: number }>()
  for (const pkg of packages) {
    const existing = ecosystemMap.get(pkg.ecosystem) ?? { current: 0, previous: null, count: 0 }
    existing.current += pkg.downloads
    if (pkg.previousDownloads !== null) {
      existing.previous = (existing.previous ?? 0) + pkg.previousDownloads
    }
    existing.count++
    ecosystemMap.set(pkg.ecosystem, existing)
  }

  const ecosystemSummary = Array.from(ecosystemMap.entries())
    .map(([ecosystem, stats]) => {
      const changeMoM = computeMoMChange(stats.current, stats.previous)
      return {
        ecosystem,
        totalDownloads: stats.current,
        previousDownloads: stats.previous,
        changeMoM,
        packageCount: stats.count,
        signal: (changeMoM !== null && changeMoM > 10) ? 'growing' as const
          : (changeMoM !== null && changeMoM < -10) ? 'declining' as const
          : 'stable' as const,
      }
    })
    .sort((a, b) => b.totalDownloads - a.totalDownloads)

  return {
    packages,
    ecosystemSummary,
    timestamp: new Date().toISOString(),
  }
}
