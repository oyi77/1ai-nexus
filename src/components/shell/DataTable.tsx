"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { type CellAccessor, filterRows, sortRows } from '@/lib/table-controls'

export interface Column<T> {
  key: string
  header: string
  width?: number | string
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
  render?: (row: T, index: number) => React.ReactNode
  accessor?: (row: T) => string | number
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  sortable?: boolean
  filterable?: boolean
  filterPlaceholder?: string
  filterValue?: string
  onFilterChange?: (value: string) => void
  virtualScroll?: boolean
  rowHeight?: number
  onRowClick?: (row: T, index: number) => void
  emptyState?: React.ReactNode
  maxHeight?: number | string
  className?: string
  stickyHeader?: boolean
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  sortable = false,
  filterable = false,
  filterPlaceholder = 'Filter rows…',
  filterValue,
  onFilterChange,
  virtualScroll = false,
  rowHeight = 32,
  onRowClick,
  emptyState,
  maxHeight,
  className = '',
  stickyHeader = true,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [internalFilter, setInternalFilter] = useState('')
  const activeFilter = filterValue ?? internalFilter
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)

  useEffect(() => {
    if (!virtualScroll || !containerRef.current) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [virtualScroll])

  const handleSort = useCallback((key: string) => {
    if (!sortable) return
    if (sortKey === key) {
      setSortDir(direction => direction === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortable, sortKey])

  const safeData = useMemo(() => Array.isArray(data) ? data : [], [data])
  const accessors = useMemo(() => {
    const map: Record<string, CellAccessor<T>> = {}
    for (const col of columns) map[col.key] = col.accessor ?? ((row: T) => row[col.key])
    return map
  }, [columns])
  const filtered = useMemo(
    () => filterRows(safeData, activeFilter, accessors),
    [safeData, activeFilter, accessors],
  )
  const sorted = useMemo(
    () => sortRows(filtered, sortKey, sortDir, accessors),
    [filtered, sortKey, sortDir, accessors],
  )

  // Virtual scroll calculations
  const sortedArr = Array.isArray(sorted) ? sorted : []
  const totalHeight = sortedArr.length * rowHeight
  const startIndex = virtualScroll ? Math.floor(scrollTop / rowHeight) : 0
  const endIndex = virtualScroll
    ? Math.min(sortedArr.length, startIndex + Math.ceil(containerHeight / rowHeight) + 5)
    : sortedArr.length
  const visibleRows = sortedArr.slice(startIndex, endIndex)

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (virtualScroll) {
      setScrollTop(e.currentTarget.scrollTop)
    }
  }, [virtualScroll])

  if (safeData.length === 0 && emptyState) {
    return <div className="p-4">{emptyState}</div>
  }

  const handleFilterChange = (value: string) => {
    if (filterValue === undefined) setInternalFilter(value)
    onFilterChange?.(value)
  }

  const alignClass = (align?: string) => {
    if (align === 'right') return 'text-right'
    if (align === 'center') return 'text-center'
    return 'text-left'
  }

  return (
    <div className="space-y-2">
      {filterable && (
        <div className="flex items-center gap-2 px-2">
          <label className="sr-only" htmlFor="data-table-filter">Filter table rows</label>
          <input
            id="data-table-filter"
            type="search"
            value={activeFilter}
            onChange={e => handleFilterChange(e.target.value)}
            placeholder={filterPlaceholder}
            className="w-full max-w-xs bg-bg-base border border-bg-border rounded px-2 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-teal-vivid"
          />
          <span className="text-[10px] font-mono text-text-muted" aria-live="polite">{sorted.length}/{safeData.length} rows</span>
        </div>
      )}
      <div ref={containerRef} className={`overflow-auto scrollbar-thin ${className}`} style={{ maxHeight: maxHeight || undefined }} onScroll={handleScroll}>
        <table role="table" className="w-full border-collapse min-w-[600px] md:min-w-0" style={{ minHeight: virtualScroll ? totalHeight : undefined }}>
          <thead role="rowgroup" className={stickyHeader ? 'sticky top-0 z-10' : ''}>
            <tr role="row" className="bg-bg-raised border-b border-bg-border">
              {columns.map(col => (
                <th key={col.key} role="columnheader" aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined} className={`px-2 py-1.5 text-[10px] font-mono font-medium text-text-muted uppercase tracking-wider ${alignClass(col.align)} ${sortable && col.sortable !== false ? 'cursor-pointer hover:text-text-secondary select-none focus-visible:outline focus-visible:outline-teal-vivid' : ''}`} style={{ width: col.width }} onClick={() => sortable && col.sortable !== false && handleSort(col.key)} tabIndex={sortable && col.sortable !== false ? 0 : undefined} onKeyDown={e => { if (sortable && col.sortable !== false && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleSort(col.key) } }}>
                  <span className="inline-flex items-center gap-1">{col.header}{sortKey === col.key && <span className="text-teal-vivid">{sortDir === 'asc' ? '↑' : '↓'}</span>}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {visibleRows.map((row, i) => {
              const actualIndex = startIndex + i
              return (
                <tr role="row" key={actualIndex} className={`border-b border-bg-border/50 hover:bg-bg-raised/50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`} style={{ height: rowHeight }} onClick={() => onRowClick?.(row, actualIndex)}>
                  {columns.map(col => <td role="cell" key={col.key} className={`px-2 text-[11px] font-mono text-text-primary ${alignClass(col.align)}`}>{col.render ? col.render(row, actualIndex) : String(row[col.key] ?? '')}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
