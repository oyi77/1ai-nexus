"use client"

import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { type CellAccessor, type SortDir, filterRows, nextSort, sortRows } from '@/lib/table-controls'

export interface TableControlsColumn<T> {
  key: string
  accessor?: (row: T) => unknown
}

export interface TableControls<T> {
  query: string
  setQuery: (query: string) => void
  sortKey: string | null
  sortDir: SortDir
  toggleSort: (key: string) => void
  /** Force an exact sort column + direction (e.g. to mirror external selector buttons). */
  setSort: (key: string | null, dir?: SortDir) => void
  /** Rows after filter + sort — render tbody from this array. */
  visible: T[]
  /** Row count before filtering. */
  total: number
}

/**
 * Client-side filter + sort state for bespoke native <table> pages.
 * Pass column accessors only where the rendered text differs from row[key].
 */
export function useTableControls<T extends Record<string, unknown>>(
  rows: T[] | undefined | null,
  columns?: TableControlsColumn<T>[],
  opts?: { initialSortKey?: string | null; initialSortDir?: SortDir },
): TableControls<T> {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(opts?.initialSortKey ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(opts?.initialSortDir ?? 'desc')

  const accessors = useMemo(() => {
    const map: Record<string, CellAccessor<T>> = {}
    for (const col of columns ?? []) if (col.accessor) map[col.key] = col.accessor
    return map
  }, [columns])

  const safeRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const visible = useMemo(
    () => sortRows(filterRows(safeRows, query, accessors), sortKey, sortDir, accessors),
    [safeRows, query, sortKey, sortDir, accessors],
  )

  const toggleSort = useCallback(
    (key: string) => {
      const next = nextSort(sortKey, sortDir, key)
      setSortKey(next.key)
      setSortDir(next.dir)
    },
    [sortKey, sortDir],
  )

  const setSort = useCallback((key: string | null, dir: SortDir = 'desc') => {
    setSortKey(key)
    setSortDir(dir)
  }, [])
  return { query, setQuery, sortKey, sortDir, toggleSort, setSort, visible, total: safeRows.length }
}

interface TableControlsBarProps {

  idPrefix: string
  query: string
  onQueryChange: (value: string) => void
  shown: number
  total: number
  placeholder?: string
}

/** Filter input + live row-count badge; place directly above the table container. */
export function TableControlsBar({ idPrefix, query, onQueryChange, shown, total, placeholder = 'Filter rows…' }: TableControlsBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
      <label className="sr-only" htmlFor={`${idPrefix}-filter`}>Filter table rows</label>
      <input
        id={`${idPrefix}-filter`}
        type="search"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 bg-bg-base border border-bg-border rounded px-2 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-teal-vivid sm:w-auto sm:flex-1 sm:max-w-xs"
      />
      <span className="text-[10px] font-mono text-text-muted whitespace-nowrap" aria-live="polite">{shown}/{total} rows</span>
    </div>
  )
}

interface SortableThProps {
  controls: TableControls<Record<string, unknown>>
  k: string
  className?: string
  children?: ReactNode
}

/**
 * Drop-in <th> replacement adding click-to-sort with aria-sort and a direction arrow.
 * Keep the original header classes via `className`.
 */
export function SortableTh({ controls, k, className = '', children }: SortableThProps) {
  const active = controls.sortKey === k
  const activate = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      controls.toggleSort(k)
    }
  }
  return (
    <th
      onClick={() => controls.toggleSort(k)}
      onKeyDown={activate}
      tabIndex={0}
      aria-sort={active ? (controls.sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`${className} cursor-pointer select-none hover:text-text-secondary focus-visible:outline focus-visible:outline-teal-vivid`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-teal-vivid">{controls.sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}
