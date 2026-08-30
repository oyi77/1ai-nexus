// ─────────────────────────────────────────────────────────────
// Meme-Alpha Platform Registry
//
// Single source of truth for which meme-trend platforms are wired
// into the API. Routes dispatch through this registry instead of
// hardcoding platform → module/TTL pairs.
//
// The platform modules live under ./<platform>/index.ts and export
// NAMED discovery/audit functions (discover<X>Tokens / audit<X>Token).
// This registry wraps them in the shared DataModule interface so the
// route layer can treat meme the same way copy-trading is wired.
//
// Adding a new platform:
//   1. Add the platform to `MemePlatform` + `MEME_PLATFORMS` in ./types.
//   2. Create ./<platform>/index.ts exporting discover<X>Tokens()
//      and (optionally) audit<X>Token() — pure RE/scrape, NEVER a
//      paid LLM call (Tier C / free tier constraint).
//   3. Wire it into MEME_REGISTRY below with enabled:true.
//
// No route edits needed — the route enumerates this registry and
// per-platform error isolation lives in the route.
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '@/lib/modules/types'
import { discoverBitgetTokens, auditBitgetToken } from './bitget'
import { discoverGateTokens, auditGateToken } from './gate'
import { discoverBotXTokens, auditBotXToken } from './botx'
import { discoverDexScreenerTokens } from './dexscreener'
import { MEME_PLATFORMS, type MemePlatform, type MemeRiskAudit } from './types'
import { discoverBirdeyeTokens, auditBirdeyeToken } from './birdeye'
import { auditRugcheckToken } from './rugcheck'
import { discoverGeckoTerminalTokens } from './geckoterminal'

const MEME_TTL = 180_000 // 3m — mirrors the bitget/gate discovery cadence

export interface MemePlatformEntry {
  platform: MemePlatform
  displayName: string
  /** Discovery module consumed by GET /api/v1/meme/leaderboard. */
  discoveryModule?: DataModule
  /** Optional honeypot/rug audit module consumed by GET /api/v1/meme/risk. */
  auditModule?: DataModule
  /** Route-layer cache TTL (ms). */
  ttlMs: number
  /** `true` only once the discovery module is wired and production-ready. */
  enabled: boolean
}

function makeDiscoveryModule(
  id: string,
  name: string,
  discover: () => Promise<unknown[]>,
): DataModule {
  return {
    id,
    name,
    category: 'defi',
    sourceType: 'public-api',
    provenance: {
      describesItself: `${name} — new-token discovery (meme alpha feed).`,
      upstreamProduct: name,
      discoveredVia: 'docs',
      fragility: 'moderate',
      lastVerified: '2026-08-28',
      toleratesAbsence: true,
    },
    isEnabled: () => true,
    async healthCheck(): Promise<ModuleHealth> {
      try {
        await discover()
        return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
      } catch (err) {
        return {
          status: 'degraded',
          lastChecked: new Date(),
          failureCount: 1,
          notes: err instanceof Error ? err.message : `${id} endpoint unreachable`,
        }
      }
    },
    async fetch<T>(_params: FetchParams): Promise<ModuleResult<T>> {
      const tokens = await discover()
      return {
        data: { tokens, total: tokens.length } as unknown as T,
        source: id,
        cached: false,
        timestamp: Date.now(),
        ttl: MEME_TTL,
      }
    },
    async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
      return {
        data: [] as unknown as T,
        source: `${id} (fallback)`,
        cached: true,
        timestamp: Date.now(),
        ttl: MEME_TTL,
      }
    },
  }
}

function makeAuditModule(
  id: string,
  name: string,
  audit: (chain: string, contract: string) => Promise<MemeRiskAudit | null>,
): DataModule {
  return {
    id,
    name,
    category: 'defi',
    sourceType: 'public-api',
    provenance: {
      describesItself: `${name} — meme token honeypot/rug risk audit.`,
      upstreamProduct: name,
      discoveredVia: 'docs',
      fragility: 'moderate',
      lastVerified: '2026-08-28',
      toleratesAbsence: true,
    },
    isEnabled: () => true,
    async healthCheck(): Promise<ModuleHealth> {
      if (typeof audit !== 'function') {
        return {
          status: 'degraded',
          lastChecked: new Date(),
          failureCount: 1,
          notes: `${id} audit fn is not callable`,
        }
      }
      return { status: 'active', lastChecked: new Date(), lastSuccess: new Date(), failureCount: 0 }
    },
    async fetch<T>(params: FetchParams): Promise<ModuleResult<T>> {
      const chain = (params.chain as string) ?? ''
      const contract = (params.contract as string) ?? ''
      const result = await audit(chain, contract)
      return {
        data: (result ? [result] : []) as unknown as T,
        source: id,
        cached: false,
        timestamp: Date.now(),
        ttl: MEME_TTL,
      }
    },
    async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
      return {
        data: [] as unknown as T,
        source: `${id} (fallback)`,
        cached: true,
        timestamp: Date.now(),
        ttl: MEME_TTL,
      }
    },
  }
}

const bitgetAudit = makeAuditModule('bitget-meme-risk', 'Bitget Wallet Meme Risk Audit', (c, k) =>
  auditBitgetToken(c, k),
)
const gateAudit = makeAuditModule('gate-meme-risk', 'Gate.io DEX Meme Risk Audit', (c, k) =>
  auditGateToken(c, k),
)

const bitgetDiscovery = makeDiscoveryModule('bitget-meme', 'Bitget Wallet Meme Alpha', () =>
  discoverBitgetTokens(),
)
const gateDiscovery = makeDiscoveryModule('gate-meme', 'Gate.io DEX Meme Alpha', () =>
  discoverGateTokens(),
)
const botxDiscovery = makeDiscoveryModule('botx-meme', 'BotX Meme Alpha', () =>
  discoverBotXTokens(),
)
const dexscreenerDiscovery = makeDiscoveryModule('dexscreener-meme', 'DEX Screener Meme Alpha', () =>
  discoverDexScreenerTokens(),
)
const birdeyeAudit = makeAuditModule('birdeye-meme-risk', 'Birdeye Forge Meme Risk Audit', (c, k) =>
  auditBirdeyeToken(c, k),
)
const rugcheckAudit = makeAuditModule('rugcheck-meme-risk', 'RugCheck Meme Risk Audit', (c, k) =>
  auditRugcheckToken(c, k),
)

const birdeyeDiscovery = makeDiscoveryModule('birdeye-meme', 'Birdeye Forge Meme Alpha', () =>
  discoverBirdeyeTokens(),
)
const geckoterminalDiscovery = makeDiscoveryModule('geckoterminal-meme', 'GeckoTerminal Meme Alpha', () =>
  discoverGeckoTerminalTokens(),
)

// Blocked server-side (browser-session / Cloudflare) — disabled stubs so
// pages/APIs can enumerate them without a live module.
const blockedDiscovery = (name: string) =>
  makeDiscoveryModule(name, `${name} (blocked server-side)`, () => Promise.resolve([]))

const registry: Record<MemePlatform, MemePlatformEntry> = {
  bitget: {
    platform: 'bitget',
    displayName: 'Bitget Wallet',
    discoveryModule: bitgetDiscovery,
    auditModule: bitgetAudit,
    ttlMs: MEME_TTL,
    enabled: true,
  },
  gate: {
    platform: 'gate',
    displayName: 'Gate.io DEX',
    discoveryModule: gateDiscovery,
    auditModule: gateAudit,
    ttlMs: MEME_TTL,
    enabled: true,
  },
  botx: {
    platform: 'botx',
    displayName: 'BotX',
    discoveryModule: botxDiscovery,
    auditModule: makeAuditModule('botx-meme-risk', 'BotX Meme Risk Audit', (c, k) =>
      auditBotXToken(c, k),
    ),
    ttlMs: MEME_TTL,
    enabled: true,
  },
  moby: {
    platform: 'moby',
    displayName: 'Moby (pending RE)',
    discoveryModule: makeDiscoveryModule('moby-meme', 'Moby Meme Alpha (pending RE)', () => Promise.resolve([])),
    ttlMs: MEME_TTL,
    enabled: false,
  },
  dexscreener: {
    platform: 'dexscreener',
    displayName: 'DEX Screener',
    discoveryModule: dexscreenerDiscovery,
    ttlMs: MEME_TTL,
    enabled: true,
  },
  // Zero-key sources (research-verified 2026-08-30):
  birdeye: {
    platform: 'birdeye',
    displayName: 'Birdeye Forge',
    discoveryModule: birdeyeDiscovery,
    auditModule: birdeyeAudit,
    ttlMs: MEME_TTL,
    enabled: true,
  },
  rugcheck: {
    platform: 'rugcheck',
    displayName: 'RugCheck',
    auditModule: rugcheckAudit,
    ttlMs: MEME_TTL,
    enabled: true,
  },
  geckoterminal: {
    platform: 'geckoterminal',
    displayName: 'GeckoTerminal',
    discoveryModule: geckoterminalDiscovery,
    ttlMs: MEME_TTL,
    enabled: true,
  },
  // Blocked server-side (browser-session / Cloudflare) — disabled stubs:
  gmgn: {
    platform: 'gmgn',
    displayName: 'GMGN (blocked server-side)',
    discoveryModule: blockedDiscovery('gmgn-meme'),
    ttlMs: MEME_TTL,
    enabled: false,
  },
  fomo: {
    platform: 'fomo',
    displayName: 'Fomo Family (blocked server-side)',
    discoveryModule: blockedDiscovery('fomo-meme'),
    ttlMs: MEME_TTL,
    enabled: false,
  },
  photon: {
    platform: 'photon',
    displayName: 'Photon (blocked server-side)',
    discoveryModule: blockedDiscovery('photon-meme'),
    ttlMs: MEME_TTL,
    enabled: false,
  },
}

/** Platform → entry map. Single source of truth for module + TTL wiring. */
export const MEME_REGISTRY: Record<MemePlatform, MemePlatformEntry> = registry

/** Discovery module for a platform, or `undefined` when unregistered/disabled. */
export function getDiscoveryModule(platform: MemePlatform): DataModule | undefined {
  const entry = registry[platform]
  return entry?.enabled ? entry.discoveryModule : undefined
}

/** Audit module for a platform, or `undefined` when none is registered/wired. */
export function getAuditModule(platform: MemePlatform): DataModule | undefined {
  return registry[platform]?.auditModule
}

/** True when the platform is enabled AND has a discovery module (misconfig guard). */
export function isPlatformEnabled(platform: MemePlatform): boolean {
  return getDiscoveryModule(platform) !== undefined
}

/** Enabled platforms in `MEME_PLATFORMS` declared order (stable output order). */
export function getEnabledPlatforms(): MemePlatform[] {
  return MEME_PLATFORMS.filter((p) => isPlatformEnabled(p))
}

/**
 * Normalize the `platform` query param. Accepts all|bitget|gate|moby|dexscreener
 * (case-insensitive). Non-matching values fall back to 'all'.
 */
export function normalizeMemePlatformParam(param: string | null): MemePlatform | 'all' {
  const p = (param ?? 'all').toLowerCase()
  if (p === 'all') return 'all'
  if ((MEME_PLATFORMS as readonly string[]).includes(p)) return p as MemePlatform
  return 'all'
}

export { MEME_PLATFORMS, type MemePlatform } from './types'
