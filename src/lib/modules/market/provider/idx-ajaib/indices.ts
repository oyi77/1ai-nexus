// ─────────────────────────────────────────────────────────────
// Ajaib IDX index membership — which codes belong to IDX30, LQ45,
// IDXBUMN20, IDX80, IDXG30, IDXHIDIV20, IDXSMC-COM, BISNIS-27, DBX,
// I-GRADE, plus thematic (saham-bank, blue-chip).
// Live-only (24h cache, no DB tables). SERVER-ONLY.
// Consume via /api/v1/saham/ajaib?market=indices[&index=IDX30].
// Live-verified 2026-09-16 (categories return RSC results[]).
// ─────────────────────────────────────────────────────────────

import { getCached } from '@/lib/api/server-cache'
import { rscGet, extractUniverseRecords } from './universe'

const CACHE_TTL = 24 * 60 * 60_000

export const IDX_INDICES = [
  'IDX30',
  'LQ45',
  'IDXBUMN20',
  'IDX80',
  'IDXG30',
  'IDXHIDIV20',
  'IDXSMC-COM',
  'BISNIS-27',
  'DBX',
  'I-GRADE',
  'saham-bank',
  'blue-chip',
] as const

export type IdxIndexName = (typeof IDX_INDICES)[number]

export interface IndexMembership {
  indices: Record<string, string[]> // index -> codes
  byCode: Record<string, string[]> // code -> indices
  capturedAt: string
}

async function fetchIndexCodes(index: string): Promise<string[]> {
  const codes: string[] = []
  let page = 1
  for (;;) {
    const { status, body: raw } = rscGet(
      `https://ajaib.co.id/saham/aset/kategori/${index}?page=${page}&page_size=100`,
    )
    if (status !== 200) throw new Error(`Ajaib index ${index} HTTP ${status}`)
    const records = extractUniverseRecords(raw)
    for (const r of records) {
      if (typeof r.code === 'string') codes.push(r.code)
    }
    if (records.length < 100) break
    page++
    if (page > 15) break
  }
  return [...new Set(codes)]
}

/** Pure merger — unit-testable, no network. */
export function mergeMembership(pairs: Array<{ index: string; codes: string[] }>): IndexMembership {
  const indices: Record<string, string[]> = {}
  const byCode: Record<string, string[]> = {}
  for (const { index, codes } of pairs) {
    const uniq = [...new Set(codes)]
    indices[index] = uniq
    for (const c of uniq) {
      const arr = byCode[c] ?? []
      if (!arr.includes(index)) arr.push(index)
      byCode[c] = arr
    }
  }
  return { indices, byCode, capturedAt: new Date().toISOString() }
}

export async function getIndexMembership(): Promise<IndexMembership> {
  const { data } = await getCached('ajaib-indices:v1', CACHE_TTL, async () => {
    const pairs: Array<{ index: string; codes: string[] }> = []
    for (const index of IDX_INDICES) {
      try {
        pairs.push({ index, codes: await fetchIndexCodes(index) })
      } catch {
        // One dead category never kills the whole map.
      }
    }
    if (pairs.length === 0) {
      const { EmptySnapshotError } = await import('./universe')
      throw new EmptySnapshotError('Ajaib indices')
    }
    return mergeMembership(pairs)
  })
  return data
}
