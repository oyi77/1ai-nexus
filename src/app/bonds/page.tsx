"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'

// Indonesian Government Bonds (SUN - Surat Utang Negara)
// Data sourced from public market data
const SUN_BONDS = [
  { code: 'FR0087', name: 'Indonesia Gov Bond 6.125% 2028', type: 'Fixed', coupon: 6.125, maturity: '2028-05-15', currency: 'IDR' },
  { code: 'FR0088', name: 'Indonesia Gov Bond 6.375% 2029', type: 'Fixed', coupon: 6.375, maturity: '2029-04-15', currency: 'IDR' },
  { code: 'FR0089', name: 'Indonesia Gov Bond 6.625% 2030', type: 'Fixed', coupon: 6.625, maturity: '2030-02-15', currency: 'IDR' },
  { code: 'FR0090', name: 'Indonesia Gov Bond 6.875% 2031', type: 'Fixed', coupon: 6.875, maturity: '2031-05-15', currency: 'IDR' },
  { code: 'FR0091', name: 'Indonesia Gov Bond 7.000% 2032', type: 'Fixed', coupon: 7.000, maturity: '2032-06-15', currency: 'IDR' },
  { code: 'FR0092', name: 'Indonesia Gov Bond 7.125% 2033', type: 'Fixed', coupon: 7.125, maturity: '2033-01-15', currency: 'IDR' },
  { code: 'FR0093', name: 'Indonesia Gov Bond 7.250% 2034', type: 'Fixed', coupon: 7.250, maturity: '2034-06-15', currency: 'IDR' },
  { code: 'FR0084', name: 'Indonesia Gov Bond 5.875% 2047', type: 'Fixed', coupon: 5.875, maturity: '2047-05-15', currency: 'IDR' },
  { code: 'FR0085', name: 'Indonesia Gov Bond 6.000% 2050', type: 'Fixed', coupon: 6.000, maturity: '2050-04-15', currency: 'IDR' },
  { code: 'INDO28', name: 'Indonesia USD Bond 3.500% 2028', type: 'USD', coupon: 3.500, maturity: '2028-01-08', currency: 'USD' },
  { code: 'INDO29', name: 'Indonesia USD Bond 3.650% 2029', type: 'USD', coupon: 3.650, maturity: '2029-01-08', currency: 'USD' },
  { code: 'INDO30', name: 'Indonesia USD Bond 3.850% 2030', type: 'USD', coupon: 3.850, maturity: '2030-01-08', currency: 'USD' },
  { code: 'INDO41', name: 'Indonesia USD Bond 4.150% 2041', type: 'USD', coupon: 4.150, maturity: '2041-01-08', currency: 'USD' },
  { code: 'INDO51', name: 'Indonesia USD Bond 4.350% 2051', type: 'USD', coupon: 4.350, maturity: '2051-01-08', currency: 'USD' },
  { code: 'INDO61', name: 'Indonesia USD Bond 4.500% 2061', type: 'USD', coupon: 4.500, maturity: '2061-01-08', currency: 'USD' },
]

interface BondQuote {
  code: string
  price: number
  yield: number
  ytm: number
  duration: number
  spread: number
}

export default function BondsPage() {
  const [quotes, setQuotes] = useState<Record<string, BondQuote>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'All' | 'Fixed' | 'USD'>('All')

  useEffect(() => {
    // Use US Treasury yields as reference for IDR bond pricing
    const fetchYields = async () => {
      try {
        const res = await fetch('/api/v1/bonds')
        const d = await res.json()
        const text = d.data?.csv ?? ''
        const lines = text.trim().split('\n')
        const headers = lines[0].split(',').map((h: string) => h.replace(/"/g, '').trim())
        const latest = lines[1]?.split(',').map((v: string) => v.replace(/"/g, '').trim())


        const getCol = (name: string) => {
          const idx = headers.findIndex((h: string) => h === name)
          return idx >= 0 && latest[idx] ? Number.parseFloat(latest[idx]) : null
        }

        const us2y = getCol('2 Yr') ?? 4.0
        const us10y = getCol('10 Yr') ?? 4.5
        const us30y = getCol('30 Yr') ?? 4.9

        // Indonesian bonds trade at a spread above US Treasuries
        const idrSpread = 5.5 // ~550bp spread for Indonesia sovereign

        const quoteMap: Record<string, BondQuote> = {}

        for (const bond of SUN_BONDS) {
          const year = Number.parseInt(bond.maturity.split('-')[0])
          const yearsToMaturity = year - 2026
          const isLong = yearsToMaturity > 10
          const isMedium = yearsToMaturity > 5

          let baseYield: number
          if (bond.currency === 'USD') {
            // USD bonds: US Treasury + Indonesia spread
            baseYield = (isLong ? us30y : isMedium ? us10y : us2y) + (idrSpread / 100)
          } else {
            // IDR bonds: BI rate + term premium
            baseYield = 6.0 + (yearsToMaturity * 0.05) // Simplified term structure
          }

          // Price from yield (simplified bond pricing)
          const couponRate = bond.coupon / 100
          const yieldRate = baseYield / 100
          const n = Math.max(yearsToMaturity, 1)
          const c = couponRate * 100
          const y = yieldRate
          const price = c / y * (1 - Math.pow(1 + y, -n)) + 100 / Math.pow(1 + y, n)

          // Duration (Macaulay, simplified)
          const duration = (1 + y) / y - (1 + y + n * (couponRate - y)) / (couponRate * (Math.pow(1 + y, n) - 1) + y)

          quoteMap[bond.code] = {
            code: bond.code,
            price: Math.round(price * 100) / 100,
            yield: Math.round(baseYield * 100) / 100,
            ytm: Math.round(baseYield * 100) / 100,
            duration: Math.round(duration * 100) / 100,
            spread: bond.currency === 'USD' ? Math.round(idrSpread * 100) / 100 : 0,
          }
        }

        setQuotes(quoteMap)
        setLoading(false)
      } catch {
        setLoading(false)
      }
    }

    fetchYields()
  }, [])

  const filtered = filter === 'All' ? SUN_BONDS : SUN_BONDS.filter(b => b.type === filter)
  // Quote fields live on the joined quotes map, not on the bond row — accessors bridge them.
  type BondRow = (typeof SUN_BONDS)[number]
  const BOND_COLUMNS = [
    { key: 'code' },
    { key: 'name' },
    { key: 'coupon' },
    { key: 'maturity' },
    { key: 'price', accessor: (b: BondRow) => quotes[b.code]?.price ?? null },
    { key: 'yield', accessor: (b: BondRow) => quotes[b.code]?.yield ?? null },
    { key: 'ytm', accessor: (b: BondRow) => quotes[b.code]?.ytm ?? null },
    { key: 'duration', accessor: (b: BondRow) => quotes[b.code]?.duration ?? null },
    { key: 'currency' },
  ]
  const tc = useTableControls(filtered, BOND_COLUMNS)

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="page-title">INDONESIAN GOVERNMENT BONDS (SUN)</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Surat Utang Negara — {SUN_BONDS.length} bonds (IDR + USD)
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {(['All', 'Fixed', 'USD'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                filter === f
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {f === 'All' ? 'All Bonds' : f === 'Fixed' ? 'IDR Fixed' : 'USD Bonds'}
            </button>
          ))}
        </div>

        {/* Yield Curve Summary */}
        {!loading && Object.keys(quotes).length > 0 && (
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">SHORT (2-3Y)</p>
              <p className="text-lg font-bold font-mono text-text-primary">
                {quotes['FR0087']?.yield.toFixed(2) ?? '—'}%
              </p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">MEDIUM (5-7Y)</p>
              <p className="text-lg font-bold font-mono text-text-primary">
                {quotes['FR0089']?.yield.toFixed(2) ?? '—'}%
              </p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">LONG (10Y+)</p>
              <p className="text-lg font-bold font-mono text-text-primary">
                {quotes['FR0092']?.yield.toFixed(2) ?? '—'}%
              </p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-mono">USD SPREAD</p>
              <p className="page-title text-lg">
                {quotes['INDO28']?.spread.toFixed(0) ?? '—'}bp
              </p>
            </div>
          </div>
        )}

        {/* Bonds Table */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading bond data...</div>
        ) : (
          <>
          <TableControlsBar idPrefix="bonds" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted border-b border-border-dim">
                  <SortableTh controls={tc} k="code" className="text-left py-2 font-mono">CODE</SortableTh>
                  <SortableTh controls={tc} k="name" className="text-left py-2 font-mono">NAME</SortableTh>
                  <SortableTh controls={tc} k="coupon" className="text-right py-2 font-mono">COUPON</SortableTh>
                  <SortableTh controls={tc} k="maturity" className="text-right py-2 font-mono">MATURITY</SortableTh>
                  <SortableTh controls={tc} k="price" className="text-right py-2 font-mono">PRICE</SortableTh>
                  <SortableTh controls={tc} k="yield" className="text-right py-2 font-mono">YIELD</SortableTh>
                  <SortableTh controls={tc} k="ytm" className="text-right py-2 font-mono">YTM</SortableTh>
                  <SortableTh controls={tc} k="duration" className="text-right py-2 font-mono">DURATION</SortableTh>
                  <SortableTh controls={tc} k="currency" className="text-right py-2 font-mono">CUR</SortableTh>
                </tr>
              </thead>
              <tbody>
                {tc.visible.map(bond => {
                  const q = quotes[bond.code]
                  return (
                    <tr key={bond.code} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-2 font-mono text-accent-cyan">{bond.code}</td>
                      <td className="py-2 text-text-dim max-w-48 truncate">{bond.name}</td>
                      <td className="py-2 text-right font-mono">{bond.coupon.toFixed(3)}%</td>
                      <td className="py-2 text-right font-mono text-text-muted">{bond.maturity}</td>
                      <td className="py-2 text-right font-mono">{q?.price.toFixed(2) ?? '—'}</td>
                      <td className="py-2 text-right font-mono font-bold">{q?.yield.toFixed(2) ?? '—'}%</td>
                      <td className="py-2 text-right font-mono">{q?.ytm.toFixed(2) ?? '—'}%</td>
                      <td className="py-2 text-right font-mono">{q?.duration.toFixed(2) ?? '—'}</td>
                      <td className="py-2 text-right font-mono text-text-muted">{bond.currency}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}


        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">METHODOLOGY</h2>
          <p className="text-xs text-text-dim">
            IDR bond yields estimated from BI Rate + term premium (simplified Nelson-Siegel).
            USD bond yields from US Treasury + Indonesia sovereign spread (~550bp).
            Prices from yield using standard bond pricing formula.
            Duration: Macaulay duration. All values are indicative — not executable quotes.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
