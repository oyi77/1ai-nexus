"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'
import { TransactionTable } from '@/components/domain/payments/transaction-table'

type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded'

interface Payment {
  id: string
  amount: number
  currency: string
  status: PaymentStatus
  provider: string
  externalId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  subscriptionId: string
  updatedAt: string
}

export default function PaymentsPage() {
  const { data, status } = useLiveFetch<Payment[]>({
    url: '/api/v1/payments/history',
    interval: 60_000,
  })

  return (
    <NexusLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold font-mono text-text-primary">Payment History</h1>
        {status === 'error' && (
          <div className="bg-bg-panel border border-red-vivid/30 rounded-lg p-4">
            <p className="text-red-vivid font-mono text-sm">Failed to load payment data. Retrying...</p>
          </div>
        )}
        {status !== 'error' && (
          <TransactionTable payments={data ?? []} />
        )}
      </div>
    </NexusLayout>
  )
}
