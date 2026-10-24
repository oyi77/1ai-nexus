import { describe, it, expect } from 'vitest'
import { getActiveNavHref } from '../nav-matcher'

describe('getActiveNavHref specificity engine', () => {
  const sampleHrefs = [
    '/',
    '/dashboard',
    '/watchlist',
    '/signals',
    '/signals?tab=alpha',
    '/signals?tab=technical&sub=breakout',
    '/meme',
    '/meme/sniper',
    '/meme/risk',
    '/compare',
    '/compare/tokens',
    '/copy-trading',
    '/copy-trading/history',
  ]

  it('1. exact match without query: /dashboard matches /dashboard', () => {
    const matched = getActiveNavHref(sampleHrefs, '/dashboard', '')
    expect(matched).toBe('/dashboard')
  })

  it('2. query parameter priority: /signals?tab=alpha matches over base /signals when query matches', () => {
    const matched = getActiveNavHref(sampleHrefs, '/signals', 'tab=alpha')
    expect(matched).toBe('/signals?tab=alpha')

    const matchedFromUrlParams = getActiveNavHref(
      sampleHrefs,
      '/signals',
      new URLSearchParams('tab=alpha&foo=bar'),
    )
    expect(matchedFromUrlParams).toBe('/signals?tab=alpha')
  })

  it('3. fallback to base path: /signals?tab=unknown falls back to /signals', () => {
    const matched = getActiveNavHref(sampleHrefs, '/signals', 'tab=unknown')
    expect(matched).toBe('/signals')
  })

  it('4. prefix collision elimination: /meme/sniper matches /meme/sniper, NEVER /meme', () => {
    const matched = getActiveNavHref(sampleHrefs, '/meme/sniper')
    expect(matched).toBe('/meme/sniper')
  })

  it('5. deep prefix nested matching: /copy-trading/leader/123 matches /copy-trading without activating sibling /copy-trading/history', () => {
    const matched = getActiveNavHref(sampleHrefs, '/copy-trading/leader/123')
    expect(matched).toBe('/copy-trading')
  })

  it('6. deep comparison specificity: /compare/tokens matches /compare/tokens, rejecting /compare', () => {
    const matched = getActiveNavHref(sampleHrefs, '/compare/tokens')
    expect(matched).toBe('/compare/tokens')
  })

  it('7. root path safety: / does not greedily match /anything', () => {
    const matchedRoot = getActiveNavHref(sampleHrefs, '/')
    expect(matchedRoot).toBe('/')

    const matchedUnregistered = getActiveNavHref(sampleHrefs, '/unknown-route')
    expect(matchedUnregistered).toBeNull()
  })

  it('8. multiple query parameters: matches full key-value sets correctly', () => {
    const matchedFull = getActiveNavHref(
      sampleHrefs,
      '/signals',
      'tab=technical&sub=breakout',
    )
    expect(matchedFull).toBe('/signals?tab=technical&sub=breakout')

    const matchedPartial = getActiveNavHref(
      sampleHrefs,
      '/signals',
      'tab=technical&sub=other',
    )
    expect(matchedPartial).toBe('/signals')
  })

  it('9. trailing slashes: normalizes /dashboard/ to /dashboard', () => {
    const matched = getActiveNavHref(sampleHrefs, '/dashboard/')
    expect(matched).toBe('/dashboard')

    const matchedNested = getActiveNavHref(sampleHrefs, '/meme/sniper/')
    expect(matchedNested).toBe('/meme/sniper')
  })

  it('10. empty or null searchParams handling', () => {
    expect(getActiveNavHref(sampleHrefs, '/signals', null)).toBe('/signals')
    expect(getActiveNavHref(sampleHrefs, '/signals', undefined)).toBe('/signals')
    expect(getActiveNavHref(sampleHrefs, '/signals', '')).toBe('/signals')
  })
})
