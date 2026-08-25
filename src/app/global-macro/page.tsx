"use client";

import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'
import { useTableControls, TableControlsBar, SortableTh } from '@/components/shell/TableControls'
import { useLiveFetch } from '@/lib/hooks/useLiveFetch'

const COUNTRIES = [
  { code: 'USA', name: 'United States', flag: '🇺🇸' },
  { code: 'CHN', name: 'China', flag: '🇨🇳' },
  { code: 'JPN', name: 'Japan', flag: '🇯🇵' },
  { code: 'DEU', name: 'Germany', flag: '🇩🇪' },
  { code: 'GBR', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'IND', name: 'India', flag: '🇮🇳' },
  { code: 'FRA', name: 'France', flag: '🇫🇷' },
  { code: 'ITA', name: 'Italy', flag: '🇮🇹' },
  { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
  { code: 'CAN', name: 'Canada', flag: '🇨🇦' },
  { code: 'KOR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'AUS', name: 'Australia', flag: '🇦🇺' },
  { code: 'IDN', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'SGP', name: 'Singapore', flag: '🇸🇬' },
  { code: 'THA', name: 'Thailand', flag: '🇹🇭' },
  { code: 'MYS', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'PHL', name: 'Philippines', flag: '🇵🇭' },
  { code: 'VNM', name: 'Vietnam', flag: '🇻🇳' },
]

const INDICATORS = ['GDP', 'GDP Growth', 'CPI', 'Inflation', 'Unemployment', 'Population', 'Real Interest']

interface MacroData {
  [countryCode: string]: { [indicator: string]: string }
}

export default function GlobalMacroPage() {
  const { data, status } = useLiveFetch<MacroData>({ url: '/api/v1/global-macro', interval: 30 * 60_000 })
  const loading = status === 'stale' && !data

  const macroData: MacroData = data ?? {}

  // Text filtering + sorting via the shared hook; indicator columns are searched and
  // ranked through accessors because their values live in macroData, not on the row.
  // The active indicator mirrors the sort column so selector buttons and sortable
  // headers stay in lockstep.
  const tc = useTableControls(COUNTRIES, INDICATORS.map(ind => ({
    key: ind,
    accessor: country => macroData[country.code]?.[ind] ?? '',
  })), { initialSortKey: 'GDP Growth', initialSortDir: 'desc' })
  const selectedIndicator = INDICATORS.includes(tc.sortKey ?? '') ? (tc.sortKey as string) : INDICATORS[0]

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">GLOBAL MACRO DASHBOARD</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              {COUNTRIES.length} countries · {INDICATORS.length} indicators · World Bank data
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : 'live'} label />
        </div>

        {/* Indicator Selector */}
        <div className="flex flex-wrap gap-2">
          {INDICATORS.map(name => (
              <button key={name} onClick={() => tc.setSort(name, 'desc')}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                selectedIndicator === name
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {name}
            </button>
          ))}
        </div>

        {/* Country Rankings */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading global macro data for {COUNTRIES.length} countries...</div>
        ) : (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h2 className="text-xs font-mono text-accent-cyan mb-3">
              {selectedIndicator.toUpperCase()} — RANKED BY {COUNTRIES.length} COUNTRIES
            </h2>
            <TableControlsBar idPrefix="global-macro" query={tc.query} onQueryChange={tc.setQuery} shown={tc.visible.length} total={tc.total} />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 font-mono w-8">#</th>
                    <SortableTh controls={tc} k="name" className="text-left py-2 font-mono">COUNTRY</SortableTh>
                    {INDICATORS.map(ind => (
                      <SortableTh key={ind} controls={tc} k={ind} className="text-right py-2 font-mono">{ind.toUpperCase()}</SortableTh>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tc.visible.length === 0 ? (
                    <tr>
                      <td colSpan={INDICATORS.length + 2} className="py-4 text-center text-text-muted text-xs">
                        No countries match the current filter.
                      </td>
                    </tr>
                  ) : (
                    tc.visible.map((country, i) => (
                      <tr key={country.code} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 font-mono text-text-muted">{i + 1}</td>
                        <td className="py-2 font-mono">
                          <span className="mr-2">{country.flag}</span>
                          <span className="text-text-primary">{country.name}</span>
                        </td>
                        {INDICATORS.map(ind => (
                          <td key={ind} className="py-2 text-right font-mono text-text-dim">
                            {macroData[country.code]?.[ind] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">SOURCE</h2>
          <p className="text-xs text-text-dim">
            World Bank Open Data (api.worldbank.org) — free, no API key.
            Covers {COUNTRIES.length} countries across {INDICATORS.length} macro indicators.
            Data is annual (latest available year). Served via backend proxy with 30-min cache.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
