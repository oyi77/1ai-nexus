// ─────────────────────────────────────────────────────────────
// Indices + dual + calendar tests — pure mergers/parsers + error
// contract. No network (live shapes verified 2026-09-16).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { mergeMembership, IDX_INDICES } from './indices'
import { DUAL_MAP, listDuals } from '../idx-dual'

describe('mergeMembership', () => {
  it('builds both directions with dedup', () => {
    const m = mergeMembership([
      { index: 'IDX30', codes: ['BBCA', 'BBRI', 'BBCA'] },
      { index: 'LQ45', codes: ['BBCA', 'TLKM'] },
    ])
    expect(m.indices.IDX30).toEqual(['BBCA', 'BBRI'])
    expect(m.byCode.BBCA).toEqual(['IDX30', 'LQ45'])
    expect(m.byCode.TLKM).toEqual(['LQ45'])
    expect(m.capturedAt).toBeTruthy()
  })

  it('covers the known index list', () => {
    expect(IDX_INDICES).toContain('IDX30')
    expect(IDX_INDICES).toContain('LQ45')
    expect(IDX_INDICES).toContain('IDXBUMN20')
  })
})

describe('dual map', () => {
  it('TLKM maps to TLK ADR', () => {
    expect(DUAL_MAP.TLKM).toBe('TLK')
    expect(listDuals()).toContainEqual({ idx: 'TLKM', us: 'TLK' })
  })
})
