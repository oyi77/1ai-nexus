"use client"

import { type ReactNode } from "react"

interface Column {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  width?: string
  hidden?: 'sm' | 'md'
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode
}

interface DenseTableProps {
  columns: Column[]
  rows: Record<string, unknown>[]
  onRowClick?: (row: Record<string, unknown>) => void
  maxHeight?: string
  className?: string
}

export function DenseTable({ columns, rows, onRowClick, maxHeight = '100%', className = '' }: DenseTableProps) {
  return (
    <div className={`overflow-auto scrollbar-thin ${className}`} style={{ maxHeight }}>
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr className="text-text-muted">
            {columns.map(col => (
              <th
                key={col.key}
                className={`text-[10px] font-mono font-normal uppercase px-2 py-1 border-b border-border-dim sticky top-0 bg-bg-deep z-10 ${
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                } ${col.hidden === 'sm' ? 'hidden sm:table-cell' : ''} ${col.hidden === 'md' ? 'hidden md:table-cell' : ''}`}
                style={{ width: col.width }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-border-dim/30 hover:bg-bg-elevated transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={`text-[11px] font-mono px-2 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  } ${col.hidden === 'sm' ? 'hidden sm:table-cell' : ''} ${col.hidden === 'md' ? 'hidden md:table-cell' : ''}`}
                  style={{ maxWidth: col.width }}
                >
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
