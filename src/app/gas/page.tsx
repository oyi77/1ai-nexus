"use client"

import { NexusLayout } from '@/components/layout/NexusLayout'
import { Panel } from '@/components/shell/Panel'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

interface GasPrice {
  chain: string
  slow: number
  standard: number
  fast: number
  unit: string
  congestion: string
}

interface GasResponse { data: GasPrice[] }

export default function GasPage() {
  const { data, status, refresh } = useLiveFetch<GasResponse>({ url: '/api/v1/gas', interval: 30_000 })
  const prices = data?.data || []

  const congestionColor = (c: string) => {
    switch (c) {
      case 'low': return 'text-data-bull'
      case 'medium': return 'text-data-warn'
      case 'high': return 'text-data-orange'
      case 'extreme': return 'text-data-bear'
      default: return 'text-data-neutral'
    }
  }

  return (
    <NexusLayout>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-head font-bold text-text-primary">⛽ Gas Tracker</h1>
            <p className="text-[11px] text-text-muted font-mono">Real-time gas prices across all chains</p>
          </div>
          <LiveDot status={status} label />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
          {prices.map((gas, i) => (
            <Panel key={i} title={gas.chain} subtitle={gas.unit}>
              <div className="p-3 space-y-3">
                <div className={`text-center text-[10px] font-mono ${congestionColor(gas.congestion)}`}>
                  {gas.congestion.toUpperCase()} CONGESTION
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Slow', value: gas.slow, color: 'text-data-bull' },
                    { label: 'Standard', value: gas.standard, color: 'text-data-warn' },
                    { label: 'Fast', value: gas.fast, color: 'text-data-bear' },
                  ].map((tier, j) => (
                    <div key={j} className="text-center">
                      <div className="text-[9px] text-text-muted font-mono uppercase">{tier.label}</div>
                      <div className={`text-[16px] font-head font-bold tabular-nums ${tier.color}`}>
                        {gas.unit === 'gwei' ? tier.value.toFixed(2) : tier.value}
                      </div>
                      <div className="text-[9px] text-text-muted">{gas.unit}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </NexusLayout>
  )
}
