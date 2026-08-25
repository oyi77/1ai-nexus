"use client"

import { useTableControls, TableControlsBar, SortableTh, type TableControlsColumn } from '@/components/shell/TableControls'

type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded'

// Type alias (not interface): useTableControls requires Record<string, unknown>,
// which TS only satisfies implicitly for type aliases.
type Payment = {
  id: string
  amount: number
  currency: string
  status: PaymentStatus
  provider: string
  externalId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string | Date
}

interface TransactionTableProps {
  payments: Payment[]
  /** DOM id prefix for the filter input; override when mounting several tables on one page. */
  idPrefix?: string
}

const statusColors: Record<PaymentStatus, string> = {
  completed: 'text-teal-vivid',
  pending: 'text-yellow-vivid',
  failed: 'text-red-vivid',
  refunded: 'text-text-muted',
}

function formatAmount(amount: number, currency: string): string {
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', IDR: 'Rp' }
  const prefix = sym[currency] || currency + ' '
  if (currency === 'IDR') return `${prefix}${Math.round(amount).toLocaleString()}`
  return `${prefix}${(amount / 100).toFixed(2)}`
}

function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Accessors cover every displayed datum (filterRows searches accessor values only);
// createdAt sorts chronologically via ISO string, amount numerically via raw value.
const paymentColumns: TableControlsColumn<Payment>[] = [
  { key: 'createdAt', accessor: p => new Date(p.createdAt).toISOString() },
  { key: 'provider', accessor: p => p.provider },
  { key: 'amount', accessor: p => p.amount },
  { key: 'currency', accessor: p => p.currency },
  { key: 'status', accessor: p => p.status },
  { key: 'externalId', accessor: p => p.externalId ?? p.id },
]

export function TransactionTable({ payments, idPrefix = 'payment-history' }: TransactionTableProps) {
  const tc = useTableControls(payments, paymentColumns)
  if (!payments || payments.length === 0) {
    return (
      <div className="bg-bg-panel border border-border-dim rounded-lg p-6">
        <h2 className="text-lg font-bold font-mono text-accent-cyan mb-4">Payment History</h2>
        <p className="text-text-muted font-mono text-sm">No payments found.</p>
      </div>
    )
  }

  return (
    <div className="bg-bg-panel border border-border-dim rounded-lg p-6 overflow-x-auto">
      <h2 className="text-lg font-bold font-mono text-accent-cyan mb-4">Payment History</h2>
      <TableControlsBar idPrefix={idPrefix} query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
      <table className="w-full text-left font-mono text-sm">
        <thead>
          <tr className="border-b border-border-dim text-text-muted text-xs uppercase tracking-wider">
            <SortableTh controls={tc} k="createdAt" className="pb-2 pr-4">Date</SortableTh>
            <SortableTh controls={tc} k="provider" className="pb-2 pr-4">Description</SortableTh>
            <SortableTh controls={tc} k="amount" className="pb-2 pr-4">Amount</SortableTh>
            <SortableTh controls={tc} k="status" className="pb-2 pr-4">Status</SortableTh>
            <SortableTh controls={tc} k="externalId" className="pb-2">Reference</SortableTh>
          </tr>
        </thead>
        <tbody>
          {tc.visible.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-4 text-center text-text-muted text-xs">
                No payments match the current filter.
              </td>
            </tr>
          ) : (
            tc.visible.map((p) => (
              <tr key={p.id} className="border-b border-border-dim/50 last:border-0 hover:bg-bg-base/50 transition-colors">
                <td className="py-3 pr-4 text-text-muted whitespace-nowrap">{formatDate(p.createdAt)}</td>
                <td className="py-3 pr-4 text-text-primary capitalize">{p.provider}</td>
                <td className="py-3 pr-4 text-text-primary font-bold whitespace-nowrap">{formatAmount(p.amount, p.currency)}</td>
                <td className="py-3 pr-4">
                  <span className={`font-bold capitalize ${statusColors[p.status] || 'text-text-muted'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="py-3 text-text-muted text-xs max-w-[120px] truncate" title={p.externalId ?? p.id}>
                  {p.externalId ?? p.id}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
