// ─────────────────────────────────────────────────────────────
// Registry audit-scope enumeration tests (pure, no network).
//
// Regression: GET /api/v1/meme/risk?platform=all enumerated
// getEnabledPlatforms(), which is discovery-gated. Audit-only adapters
// (rugcheck has an auditModule but no discoveryModule) were silently
// dropped from the sweep even though api-docs advertises them.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  getEnabledAuditPlatforms,
  getEnabledPlatforms,
  getAuditModule,
  getDiscoveryModule,
  MEME_PLATFORMS,
} from '../index'

describe('registry audit-scoped enumeration', () => {
  it('includes every enabled platform that has an audit module', () => {
    const auditPlatforms = getEnabledAuditPlatforms()
    for (const p of auditPlatforms) {
      expect(getAuditModule(p), `${p} listed but has no audit module`).toBeDefined()
    }
  })

  it('excludes platforms without an audit module', () => {
    // dexscreener + geckoterminal are discovery-only (no risk audit).
    expect(getEnabledAuditPlatforms()).not.toContain('dexscreener')
    expect(getEnabledAuditPlatforms()).not.toContain('geckoterminal')
  })

  it('includes audit-only platforms the discovery-gated list drops', () => {
    // rugcheck: auditModule registered, no discoveryModule.
    expect(getAuditModule('rugcheck')).toBeDefined()
    expect(getDiscoveryModule('rugcheck')).toBeUndefined()

    expect(getEnabledPlatforms()).not.toContain('rugcheck')
    expect(getEnabledAuditPlatforms()).toContain('rugcheck')
  })

  it('is a superset of the discovery list restricted to audited platforms', () => {
    const auditSet = new Set(getEnabledAuditPlatforms())
    const discoveryAudited = getEnabledPlatforms().filter((p) => getAuditModule(p) !== undefined)
    for (const p of discoveryAudited) {
      expect(auditSet.has(p), `${p} discoverable+audited but missing from audit sweep`).toBe(true)
    }
  })

  it('preserves MEME_PLATFORMS declared order', () => {
    const auditPlatforms = getEnabledAuditPlatforms()
    const declared = MEME_PLATFORMS.filter((p) => auditPlatforms.includes(p))
    expect(auditPlatforms).toEqual(declared)
  })
})
