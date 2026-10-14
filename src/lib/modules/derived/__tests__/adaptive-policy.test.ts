import { describe, expect, it } from 'vitest'
import { adaptDeliveryPolicy, adaptivePolicyReason, resolveAdaptivePolicy } from '../adaptive-policy'
import { DEFAULT_DELIVERY_POLICY } from '../signal-tier'

const BASE = { ...DEFAULT_DELIVERY_POLICY, allowWatchlist: true }

describe('adaptDeliveryPolicy', () => {
  it('demotes HIGH_CONVICTION below floor with enough scored → allowTopSignal=false', () => {
    const policy = adaptDeliveryPolicy({
      base: BASE,
      byTier: { HIGH_CONVICTION: { scored: 10, hitRatePct: 40 } },
    })

    expect(policy.allowTopSignal).toBe(false)
    expect(policy.allowWatchlist).toBe(true) // untouched
  })

  it('keeps allowTopSignal=true when HIGH_CONVICTION is above floor', () => {
    const policy = adaptDeliveryPolicy({
      base: BASE,
      byTier: { HIGH_CONVICTION: { scored: 10, hitRatePct: 80 } },
    })

    expect(policy.allowTopSignal).toBe(true)
    expect(policy.allowWatchlist).toBe(true)
  })

  it('does NOT demote when hitRatePct is null', () => {
    const policy = adaptDeliveryPolicy({
      base: BASE,
      byTier: { HIGH_CONVICTION: { scored: 10, hitRatePct: null } },
    })

    expect(policy.allowTopSignal).toBe(true)
    expect(policy.allowWatchlist).toBe(true)
  })

  it('does NOT demote when scored < minScored', () => {
    const policy = adaptDeliveryPolicy({
      base: BASE,
      byTier: { HIGH_CONVICTION: { scored: 4, hitRatePct: 10 } },
    })

    expect(policy.allowTopSignal).toBe(true)
  })

  it('WATCHLIST/CANDIDATE demotion flips allowWatchlist=false by default', () => {
    const policy = adaptDeliveryPolicy({
      base: BASE,
      byTier: { WATCHLIST: { scored: 10, hitRatePct: 30 } },
    })

    expect(policy.allowWatchlist).toBe(false)
    expect(policy.allowTopSignal).toBe(true)
  })

  it('demoteWatchlist:false keeps allowWatchlist=true', () => {
    const policy = adaptDeliveryPolicy({
      base: BASE,
      byTier: { CANDIDATE: { scored: 10, hitRatePct: 30 } },
      opts: { demoteWatchlist: false },
    })

    expect(policy.allowWatchlist).toBe(true)
    expect(policy.allowTopSignal).toBe(true)
  })

  it('never promotes a tier above base (allowTopSignal already false stays false)', () => {
    const policy = adaptDeliveryPolicy({
      base: { ...BASE, allowTopSignal: false },
      byTier: { HIGH_CONVICTION: { scored: 10, hitRatePct: 90 } },
    })

    expect(policy.allowTopSignal).toBe(false)
  })

  it('does not mutate the base policy', () => {
    const base = { ...BASE }
    adaptDeliveryPolicy({
      base,
      byTier: {
        HIGH_CONVICTION: { scored: 10, hitRatePct: 40 },
        WATCHLIST: { scored: 10, hitRatePct: 30 },
      },
    })

    expect(base).toEqual(BASE)
  })
})

describe('adaptivePolicyReason', () => {
  it('returns null on no change', () => {
    const input = {
      base: BASE,
      byTier: { HIGH_CONVICTION: { scored: 10, hitRatePct: 80 } },
    }

    expect(adaptivePolicyReason(input)).toBeNull()
  })

  it('returns a non-null reason naming the tier on change', () => {
    const input = {
      base: BASE,
      byTier: { HIGH_CONVICTION: { scored: 10, hitRatePct: 40 } },
    }

    const reason = adaptivePolicyReason(input)
    expect(reason).not.toBeNull()
    expect(reason).toContain('HIGH_CONVICTION')
    expect(reason).toContain('allowTopSignal=false')
  })

  it('returns null when the base flag is already false (nothing demoted)', () => {
    const input = {
      base: { ...BASE, allowWatchlist: false },
      byTier: { WATCHLIST: { scored: 10, hitRatePct: 30 } },
    }

    expect(adaptivePolicyReason(input)).toBeNull()
  })
})

describe('resolveAdaptivePolicy', () => {
  const byTier = { HIGH_CONVICTION: { scored: 10, hitRatePct: 40 } }

  it('off: returns the base policy unchanged without computing a reason', () => {
    const resolved = resolveAdaptivePolicy(BASE, byTier, 'off')

    expect(resolved.policy).toEqual(BASE)
    expect(resolved.reason).toBeNull()
    expect(resolved.effective).toBe(false)
  })

  it('on: returns the adapted policy and marks it effective', () => {
    const resolved = resolveAdaptivePolicy(BASE, byTier, 'on')

    expect(resolved.policy.allowTopSignal).toBe(false)
    expect(resolved.policy.allowWatchlist).toBe(true)
    expect(resolved.reason).toContain('allowTopSignal=false')
    expect(resolved.effective).toBe(true)
  })

  it('dry-run: computes reason but returns the base policy unchanged', () => {
    const resolved = resolveAdaptivePolicy(BASE, byTier, 'dry-run')

    expect(resolved.policy).toEqual(BASE)
    expect(resolved.reason).toContain('allowTopSignal=false')
    expect(resolved.effective).toBe(false)
  })

  it('dry-run: reports no change when the adapted policy equals the base', () => {
    const resolved = resolveAdaptivePolicy(
      BASE,
      { HIGH_CONVICTION: { scored: 10, hitRatePct: 80 } },
      'dry-run',
    )

    expect(resolved.policy).toEqual(BASE)
    expect(resolved.reason).toBeNull()
    expect(resolved.effective).toBe(false)
  })

  it('on: does not mutate the base policy', () => {
    const base = { ...BASE }
    resolveAdaptivePolicy(base, byTier, 'on')

    expect(base).toEqual(BASE)
  })
})
