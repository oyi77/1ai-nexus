export type SortDir = 'asc' | 'desc'

export type CellAccessor<T> = (row: T) => unknown

/** Normalize any cell value to its display string (null/undefined -> ''). */
export function cellString(value: unknown): string {
  return String(value ?? '')
}

/**
 * Compare two cell values: numeric when both are numbers,
 * otherwise locale-aware string comparison of their display text.
 */
export function compareCells(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
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
