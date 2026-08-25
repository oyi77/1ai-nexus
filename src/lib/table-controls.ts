export type SortDir = 'asc' | 'desc'

export type CellAccessor<T> = (row: T) => unknown

/** Normalize any cell value to its display string (null/undefined -> ''). */
export function cellString(value: unknown): string {
  return String(value ?? '')
}

const SI_SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }

/**
 * Parse a display string into a sortable number: handles "$80,060", "+3.8%",
 * "(1,234)", "-$1.2B", "45K", "2.5M". Returns null when the value is not
 * (entirely) numeric after stripping formatting. Percent signs are treated as
 * face value (monotonic, so ordering is unaffected).
 */
export function parseCellNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  let s = value.trim()
  if (!s) return null
  const negative = /^[-(]/.test(s)
  s = s.replace(/^[-(]+/, '').replace(/\)$/, '')
  s = s.replace(/^[$€£¥+]+/, '')
  s = s.replace(/[,\s]/g, '')
  const m = /^(\d+\.?\d*|\.\d+)([kKmMbBtT%]?)$/.exec(s)
  if (!m) return null
  let n = Number.parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const suffix = m[2].toLowerCase()
  if (suffix && suffix !== '%') n *= SI_SUFFIX[suffix]
  return negative ? -n : n
}

/**
 * Compare two cell values: numerically when both are numbers OR both parse as
 * formatted numeric strings; otherwise locale-aware string comparison of their
 * display text.
 */
export function compareCells(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const na = parseCellNumber(a)
  const nb = parseCellNumber(b)
  if (na !== null && nb !== null) return na - nb
  return cellString(a).localeCompare(cellString(b))
}

/**
 * Case-insensitive substring filter over the provided accessors.
 * When no accessors are given, falls back to searching every own value of the row.
 */
export function filterRows<T>(
  rows: T[],
  query: string,
  accessors: Record<string, CellAccessor<T>> = {},
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  const fns = Object.values(accessors)
  return rows.filter(row =>
    fns.length > 0
      ? fns.some(fn => cellString(fn(row)).toLowerCase().includes(q))
      : Object.values(row as Record<string, unknown>).some(v => cellString(v).toLowerCase().includes(q)),
  )
}

/**
 * Stable sort by column key (accessor override wins over raw row[key]).
 * Descending reverses the ascending comparator so ties keep input order.
 */
export function sortRows<T>(
  rows: T[],
  key: string | null,
  dir: SortDir,
  accessors: Record<string, CellAccessor<T>> = {},
): T[] {
  if (!key) return rows
  const acc = accessors[key]
  return [...rows].sort((a, b) => {
    const va = acc ? acc(a) : (a as Record<string, unknown>)[key]
    const vb = acc ? acc(b) : (b as Record<string, unknown>)[key]
    const cmp = compareCells(va, vb)
    return dir === 'asc' ? cmp : -cmp
  })
}

/** Toggle state machine: new column sorts desc first; same column flips direction. */
export function nextSort(
  currentKey: string | null,
  currentDir: SortDir,
  clickedKey: string,
): { key: string | null; dir: SortDir } {
  if (currentKey !== clickedKey) return { key: clickedKey, dir: 'desc' }
  return { key: currentKey, dir: currentDir === 'asc' ? 'desc' : 'asc' }
}
