// ─────────────────────────────────────────────────────────────
// Module: Moby (moby.win) — Meme Alpha  [ PENDING APK REVERSE-ENGINEERING ]
// sourceType: pending
// upstreamProduct: Moby — smart-money meme screener (mobile-first, $MOBY)
// status: DISABLED in meme registry until APK RE lands.
//
// WHY PENDING (no fabricated endpoints):
//   - Moby exposes no public REST SDK. The handoff directive is to
//     "RE the apk". In this environment `apktool`/`jadx` are NOT
//     installed and no Moby APK is present, so the real API base /
//     new-token endpoint / honeypot endpoint / auth header are UNKNOWN.
//   - Per engineering rules we do NOT invent endpoints. This module
//     is a documented placeholder that enumerates exactly what the
//     RE pass must extract, and it fails closed (throws) so it can
//     never return fake data.
//
// RE PLAN (to enable this module):
//   1. Obtain moby.win APK (apkcombo/apkpure or `adb pull` from device).
//   2. `apt-get install -y apktool jadx` (or download static binaries).
//   3. `apktool d moby.apk` → inspect AndroidManifest for exported
//      network endpoints; `jadx -e moby.apk` → grep strings/Java for
//      the API base, new-token listing route, risk/honeypot route,
//      and any signature/auth header.
//   4. Mirror src/lib/modules/meme/gate|bitget to implement:
//        - discoverMobyTokens() → MemeAlphaToken[]
//        - auditMobyToken(chain, address) → MemeRiskAudit | null
//   5. Flip `isEnabled` to true, register in MEME_REGISTRY as
//      enabled:true, delete this doc block.
// ─────────────────────────────────────────────────────────────

import type { DataModule, FetchParams, ModuleResult, ModuleHealth } from '../../types'
import { TTL } from '../../types'
import type { MemeAlphaToken, MemeRiskAudit } from '../types'

const MODULE_ID = 'moby-meme'
const MOBY_TTL = TTL.TOKEN_DATA * 6

class MobyNotImplemented extends Error {
  constructor() {
    super('Moby meme module pending APK reverse-engineering — endpoints not yet extracted')
    this.name = 'MobyNotImplemented'
  }
}

async function discoverMobyTokens(): Promise<MemeAlphaToken[]> {
  throw new MobyNotImplemented()
}

async function auditMobyToken(): Promise<MemeRiskAudit | null> {
  throw new MobyNotImplemented()
}

const mobyMemeModule: DataModule = {
  id: MODULE_ID,
  name: 'Moby Meme Alpha (pending RE)',
  category: 'defi',
  sourceType: 'pending',
  provenance: {
    describesItself: 'Moby smart-money meme screener — PENDING APK reverse-engineering. Endpoints unknown.',
    upstreamProduct: 'Moby (moby.win)',
    discoveredVia: 'computed',
    fragility: 'unknown',
    lastVerified: '2026-08-28',
    toleratesAbsence: true,
  },

  // Disabled until APK RE supplies real endpoints.
  isEnabled: () => false,

  async healthCheck(): Promise<ModuleHealth> {
    return {
      status: 'degraded',
      lastChecked: new Date(),
      failureCount: 1,
      notes: 'Moby meme module disabled: pending APK reverse-engineering',
    }
  },

  async fetch<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    // Never pretends to succeed — surfaces the blocker to the caller.
    throw new MobyNotImplemented()
  },

  async fallbackFn<T>(_params: FetchParams): Promise<ModuleResult<T>> {
    return {
      data: [] as unknown as T,
      source: 'moby-meme (pending)',
      cached: true,
      timestamp: Date.now(),
      ttl: MOBY_TTL,
    }
  },
}

export default mobyMemeModule
export { discoverMobyTokens, auditMobyToken }
