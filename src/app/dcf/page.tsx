"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface DCFInputs {
  symbol: string
  currentPrice: number
  freeCashFlow: number
  growthRate5Y: number
  growthRate10Y: number
  terminalGrowthRate: number
  discountRate: number
  sharesOutstanding: number
  netDebt: number
}

interface DCFResult {
  intrinsicValue: number
  upside: number
  marginOfSafety: number
  impliedGrowth: number
  year5Value: number
  year10Value: number
  terminalValue: number
  presentValue: number
}

const PRESETS = [
  { symbol: 'AAPL', name: 'Apple', fcf: 110e9, growth5y: 0.08, growth10y: 0.05, shares: 15.2e9, debt: 100e9, price: 195 },
  { symbol: 'MSFT', name: 'Microsoft', fcf: 70e9, growth5y: 0.12, growth10y: 0.08, shares: 7.4e9, debt: 50e9, price: 450 },
  { symbol: 'GOOGL', name: 'Alphabet', fcf: 80e9, growth5y: 0.10, growth10y: 0.07, shares: 12.5e9, debt: 30e9, price: 175 },
  { symbol: 'AMZN', name: 'Amazon', fcf: 55e9, growth5y: 0.15, growth10y: 0.10, shares: 10.3e9, debt: 150e9, price: 200 },
  { symbol: 'NVDA', name: 'NVIDIA', fcf: 40e9, growth5y: 0.25, growth10y: 0.15, shares: 24.5e9, debt: 10e9, price: 130 },
  { symbol: 'META', name: 'Meta', fcf: 50e9, growth5y: 0.10, growth10y: 0.06, shares: 2.5e9, debt: 30e9, price: 550 },
  { symbol: 'TSLA', name: 'Tesla', fcf: 10e9, growth5y: 0.20, growth10y: 0.12, shares: 3.2e9, debt: 5e9, price: 250 },
  { symbol: 'BBCA.JK', name: 'BCA', fcf: 35e9, growth5y: 0.10, growth10y: 0.07, shares: 12.4e9, debt: 0, price: 9500 },
]

function runDCF(inputs: DCFInputs): DCFResult {
  const { freeCashFlow: fcf, growthRate5Y: g5, growthRate10Y: g10, terminalGrowthRate: tg, discountRate: r, sharesOutstanding: shares, netDebt: debt } = inputs

  let projectedFCF = fcf
  const yearlyFCF: number[] = []

  for (let i = 0; i < 5; i++) {
    projectedFCF *= (1 + g5)
    yearlyFCF.push(projectedFCF)
  }

  for (let i = 0; i < 5; i++) {
    projectedFCF *= (1 + g10)
    yearlyFCF.push(projectedFCF)
  }

  const terminalValue = (projectedFCF * (1 + tg)) / (r - tg)

  let presentValue = 0
  for (let i = 0; i < 10; i++) {
    presentValue += yearlyFCF[i] / Math.pow(1 + r, i + 1)
  }
  presentValue += terminalValue / Math.pow(1 + r, 10)

  const equityValue = presentValue - debt
  const intrinsicValue = equityValue / shares

  const currentMarketCap = inputs.currentPrice * shares
  const impliedGrowth = ((currentMarketCap + debt) * r - fcf * (1 + tg)) / (currentMarketCap + debt + fcf)

  return {
    intrinsicValue: Math.round(intrinsicValue * 100) / 100,
    upside: Math.round(((intrinsicValue / inputs.currentPrice) - 1) * 100 * 100) / 100,
    marginOfSafety: Math.round(((intrinsicValue - inputs.currentPrice) / intrinsicValue) * 100 * 100) / 100,
    impliedGrowth: Math.round(impliedGrowth * 100 * 100) / 100,
    year5Value: Math.round(yearlyFCF[4] / shares * 100) / 100,
    year10Value: Math.round(yearlyFCF[9] / shares * 100) / 100,
    terminalValue: Math.round(terminalValue / shares * 100) / 100,
    presentValue: Math.round(presentValue / shares * 100) / 100,
  }
}

export default function DCFPage() {
  const [selected, setSelected] = useState(PRESETS[0])
  const [inputs, setInputs] = useState<DCFInputs>({
    symbol: PRESETS[0].symbol,
    currentPrice: PRESETS[0].price,
    freeCashFlow: PRESETS[0].fcf,
    growthRate5Y: PRESETS[0].growth5y,
    growthRate10Y: PRESETS[0].growth10y,
    terminalGrowthRate: 0.03,
    discountRate: 0.10,
    sharesOutstanding: PRESETS[0].shares,
    netDebt: PRESETS[0].debt,
  })
  const [result, setResult] = useState<DCFResult | null>(null)

  useEffect(() => {
    const r = runDCF(inputs)
    setResult(r)
  }, [inputs])

  const handlePreset = (preset: typeof PRESETS[0]) => {
    setSelected(preset)
    setInputs({
      symbol: preset.symbol,
      currentPrice: preset.price,
      freeCashFlow: preset.fcf,
      growthRate5Y: preset.growth5y,
      growthRate10Y: preset.growth10y,
      terminalGrowthRate: 0.03,
      discountRate: 0.10,
      sharesOutstanding: preset.shares,
      netDebt: preset.debt,
    })
  }

  const updateInput = (key: keyof DCFInputs, value: string) => {
    const num = Number.parseFloat(value)
    if (!Number.isNaN(num)) {
      setInputs(prev => ({ ...prev, [key]: num }))
    }
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">DCF VALUATION MODEL</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Discounted Cash Flow — {PRESETS.length} preset companies
            </p>
          </div>
          <LiveDot status="live" label />
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button key={p.symbol} onClick={() => handlePreset(p)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                selected.symbol === p.symbol
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {p.symbol}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-5 space-y-4">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <h3 className="text-xs font-mono text-accent-cyan mb-3">ASSUMPTIONS</h3>
              <div className="space-y-3">
                {[
                  ['Current Price ($)', 'currentPrice'],
                  ['Free Cash Flow ($)', 'freeCashFlow'],
                  ['5Y Growth Rate (%)', 'growthRate5Y'],
                  ['10Y Growth Rate (%)', 'growthRate10Y'],
                  ['Terminal Growth (%)', 'terminalGrowthRate'],
                  ['Discount Rate/WACC (%)', 'discountRate'],
                  ['Shares Outstanding', 'sharesOutstanding'],
                  ['Net Debt ($)', 'netDebt'],
                ].map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between">
                    <label className="text-[10px] text-text-muted font-mono">{label}</label>
                    <input
                      type="number"
                      value={key.includes('Rate') || key.includes('growth') || key.includes('discount')
                        ? ((inputs[key as keyof DCFInputs] as number) * 100).toFixed(1)
                        : String(inputs[key as keyof DCFInputs])}
                      onChange={e => {
                        const val = e.target.value
                        if (key.includes('Rate') || key.includes('growth') || key.includes('discount')) {
                          updateInput(key as keyof DCFInputs, (Number.parseFloat(val) / 100).toString())
                        } else {
                          updateInput(key as keyof DCFInputs, val)
                        }
                      }}
                      className="w-28 px-2 py-1 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary text-right"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-7 space-y-4">
            {result && (
              <>
                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <h3 className="text-xs font-mono text-accent-cyan mb-3">VALUATION RESULT</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-text-muted font-mono">INTRINSIC VALUE</p>
                      <p className="text-2xl font-bold font-mono text-text-primary">${fmt(result.intrinsicValue)}</p>
                      <p className="text-xs text-text-muted font-mono">Current: ${fmt(inputs.currentPrice)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted font-mono">UPSIDE / DOWNSIDE</p>
                      <p className={`text-2xl font-bold font-mono ${result.upside >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                        {result.upside >= 0 ? '+' : ''}{result.upside}%
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-border-dim">
                    <div className={`text-center p-3 rounded ${
                      result.upside >= 20 ? 'bg-data-bull/20 text-data-bull' :
                      result.upside >= 0 ? 'bg-data-bull/10 text-data-bull' :
                      result.upside >= -20 ? 'bg-data-bear/10 text-data-bear' :
                      'bg-data-bear/20 text-data-bear'
                    }`}>
                      <p className="text-sm font-mono font-bold">
                        {result.upside >= 20 ? 'STRONG BUY' : result.upside >= 0 ? 'BUY' : result.upside >= -20 ? 'HOLD' : 'SELL'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
                  <h3 className="text-xs font-mono text-accent-cyan mb-3">SENSITIVITY ANALYSIS</h3>
                  <p className="text-[10px] text-text-muted font-mono mb-2">Intrinsic Value by Growth × Discount Rate</p>
                  <div className="overflow-x-auto">
                    <table className="text-[10px]">
                      <thead>
                        <tr className="text-text-muted">
                          <th className="p-1 text-right font-mono">Growth</th>
                          {[-0.02, -0.01, 0, 0.01, 0.02].map(delta => (
                            <th key={delta} className="p-1 text-right font-mono">WACC {((inputs.discountRate + delta) * 100).toFixed(0)}%</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[-0.05, -0.02, 0, 0.02, 0.05].map(gDelta => (
                          <tr key={gDelta}>
                            <td className="p-1 text-right font-mono text-text-muted">{((inputs.growthRate5Y + gDelta) * 100).toFixed(0)}%</td>
                            {[-0.02, -0.01, 0, 0.01, 0.02].map(rDelta => {
                              const testResult = runDCF({ ...inputs, growthRate5Y: inputs.growthRate5Y + gDelta, discountRate: inputs.discountRate + rDelta })
                              const isBase = gDelta === 0 && rDelta === 0
                              return (
                                <td key={rDelta} className={`p-1 text-right font-mono ${isBase ? 'font-bold text-accent-cyan' : testResult.intrinsicValue > inputs.currentPrice ? 'text-data-bull' : 'text-data-bear'}`}>
                                  ${fmt(testResult.intrinsicValue)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
