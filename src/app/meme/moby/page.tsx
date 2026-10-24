import { Suspense } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { MobyScreening } from './screening'

export default function MobyPage() {
  return (
    <NexusLayout>
      <Suspense fallback={<div className="p-4 text-xs font-mono text-text-muted">Loading Moby screener...</div>}>
        <MobyScreening />
      </Suspense>
    </NexusLayout>
  )
}
