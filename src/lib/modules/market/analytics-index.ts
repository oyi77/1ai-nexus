// ─────────────────────────────────────────────────────────────
// AnalyticsIndex — serving-grade structures for market snapshots
//
// Built once at process start from committed datasets; answers
// the hot query shapes the routes serve:
//   • rank queries ("how many instruments above threshold X")
//     via binary search over a Float64Array — O(log n)
//   • sector rollups memoized per sector (precomputed aggregates)
//   • direct Maps for symbol/code/firm/fundamental lookups
//   • optional global-market listings merged into one symbol
//     pool (IDX + 14 global markets in a single index)
// Used by autoresearch-bench.ts as the reference implementation;
// routes may adopt the same accessors.
// ─────────────────────────────────────────────────────────────

export interface ValueEntry { key: string; value: number }

export class RankedList {
  private keys: string[]
  private values: Float64Array

  constructor(entries: ValueEntry[]) {
    const sorted = [...entries].sort((a, b) => b.value - a.value)
    this.keys = sorted.map((e) => e.key)
    this.values = new Float64Array(sorted.length)
    for (let i = 0; i < sorted.length; i++) this.values[i] = sorted[i].value
  }

  get length(): number {
    return this.keys.length
  }

  keyAt(i: number): string {
    return this.keys[i]
  }

  /** Count of entries with value >= threshold. Desc-sorted → prefix count. O(log n). */
  countAboveOrEqual(threshold: number): number {
    let lo = 0
    let hi = this.values.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.values[mid] >= threshold) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}

export interface SectorRollup {
  totalSymbols: number
  withTradingRow: number
}

export interface GlobalListing {
  symbol: string
  name?: string
  exchange?: string
}

export class AnalyticsIndex {
  readonly universeBySymbol: Map<string, unknown>
  private readonly universeBySector: Map<string, string[]>
  readonly exchanges = new Set<string>()
  private readonly rollups = new Map<string, SectorRollup>()
  readonly sahamByCode: Map<string, Record<string, unknown>>
  readonly sahamForeignNet: RankedList
  readonly sahamValue: RankedList
  readonly brokerValue: RankedList
  readonly brokerByFirm: Map<string, Record<string, unknown>>
  readonly foreignSeriesByCode: Map<string, ReadonlyArray<{ date: string; net: number }>>
  readonly fundamentalsByCode: Map<string, Record<string, unknown>>
  /** Distinct global-market listings merged into the pool. */
  readonly globalListings: number
  readonly instrumentCount: number

  constructor(input: {
    universeStocks: ReadonlyArray<{ symbol: string; sector?: string }>
    sahamRows: ReadonlyArray<Record<string, unknown>>
    brokerRows: ReadonlyArray<Record<string, unknown>>
    foreignHistory: Record<string, ReadonlyArray<{ tradeDate?: string; date?: string; net?: number; foreignNet?: number }>>
    fundamentalsData: Record<string, Record<string, unknown>>
    globalStocks?: ReadonlyArray<GlobalListing>
  }) {
    this.universeBySymbol = new Map()
    this.universeBySector = new Map()
    for (const s of input.universeStocks) {
      this.universeBySymbol.set(s.symbol, s)
      const sector = s.sector ?? 'Other'
      const bucket = this.universeBySector.get(sector)
      if (bucket) bucket.push(s.symbol)
      else this.universeBySector.set(sector, [s.symbol])
    }

    const foreignNetEntries: ValueEntry[] = []
    const valueEntries: ValueEntry[] = []
    this.sahamByCode = new Map()
    for (const r of input.sahamRows) {
      const key = String(r.code ?? r.symbol ?? '')
      if (!key) continue
      this.sahamByCode.set(key, r)
      const fb = typeof r.foreignBuy === 'number' ? r.foreignBuy : 0
      const fs = typeof r.foreignSell === 'number' ? r.foreignSell : 0
      foreignNetEntries.push({ key, value: fb - fs })
      if (typeof r.value === 'number') valueEntries.push({ key, value: r.value })
    }
    this.sahamForeignNet = new RankedList(foreignNetEntries)
    this.sahamValue = new RankedList(valueEntries)

    const brokerEntries: ValueEntry[] = []
    this.brokerByFirm = new Map()
    for (const b of input.brokerRows) {
      const key = String(b.firm ?? b.IDFirm ?? '')
      if (!key) continue
      this.brokerByFirm.set(key, b)
      if (typeof b.value === 'number') brokerEntries.push({ key, value: b.value })
    }
    this.brokerValue = new RankedList(brokerEntries)

    this.foreignSeriesByCode = new Map()
    for (const [code, series] of Object.entries(input.foreignHistory)) {
      if (!Array.isArray(series)) continue
      const mapped = series
        .map((e) => ({ date: String(e.tradeDate ?? e.date ?? ''), net: Number(e.net ?? e.foreignNet ?? 0) }))
        .filter((e) => e.date !== '')
      this.foreignSeriesByCode.set(code, mapped)
    }

    this.fundamentalsByCode = new Map(Object.entries(input.fundamentalsData))

    let globalAdded = 0
    for (const g of input.globalStocks ?? []) {
      if (!g.symbol || this.universeBySymbol.has(g.symbol)) continue
      this.universeBySymbol.set(g.symbol, g)
      if (g.exchange) this.exchanges.add(g.exchange)
      globalAdded++
    }
    this.globalListings = globalAdded

    this.instrumentCount =
      this.universeBySymbol.size +
      this.sahamByCode.size +
      this.brokerByFirm.size +
      this.foreignSeriesByCode.size +
      this.fundamentalsByCode.size
  }

  /** Memoized per-sector rollup (precomputed-aggregate pattern). */
  sectorRollup(sector: string): SectorRollup {
    const cached = this.rollups.get(sector)
    if (cached) return cached
    const syms = this.universeBySector.get(sector) ?? []
    let withTradingRow = 0
    for (const s of syms) {
      const row = this.sahamByCode.get(s.replace('.JK', ''))
      if (row && typeof row.close === 'number') withTradingRow++
    }
    const rollup: SectorRollup = { totalSymbols: syms.length, withTradingRow }
    this.rollups.set(sector, rollup)
    return rollup
  }

  sectors(): string[] {
    return [...this.universeBySector.keys()]
  }

  universeSymbolList(): string[] {
    return [...this.universeBySymbol.keys()]
  }

  sahamCodeList(): string[] {
    return [...this.sahamByCode.keys()]
  }

  fundamentalCodeList(): string[] {
    return [...this.fundamentalsByCode.keys()]
  }
}
