"use client"

type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded'

interface Payment {
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

export function TransactionTable({ payments }: TransactionTableProps) {
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
      <table className="w-full text-left font-mono text-sm">
        <thead>
          <tr className="border-b border-border-dim text-text-muted text-xs uppercase tracking-wider">
            <th className="pb-2 pr-4">Date</th>
            <th className="pb-2 pr-4">Description</th>
            <th className="pb-2 pr-4">Amount</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2">Reference</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
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
          ))}
        </tbody>
      </table>
    </div>
  )
}
