"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface MacroIndicator {
  country: string
  countryCode: string
  flag: string
  gdp: string | null
  gdpGrowth: string | null
  inflation: string | null
  unemployment: string | null
  population: string | null
  interestRate: string | null
}

const COUNTRIES = [
  { code: 'USA', name: 'United States', flag: '🇺🇸', wbCode: 'US' },
  { code: 'CHN', name: 'China', flag: '🇨🇳', wbCode: 'CN' },
  { code: 'JPN', name: 'Japan', flag: '🇯🇵', wbCode: 'JP' },
  { code: 'DEU', name: 'Germany', flag: '🇩🇪', wbCode: 'DE' },
  { code: 'GBR', name: 'United Kingdom', flag: '🇬🇧', wbCode: 'GB' },
  { code: 'IND', name: 'India', flag: '🇮🇳', wbCode: 'IN' },
  { code: 'FRA', name: 'France', flag: '🇫🇷', wbCode: 'FR' },
  { code: 'ITA', name: 'Italy', flag: '🇮🇹', wbCode: 'IT' },
  { code: 'BRA', name: 'Brazil', flag: '🇧🇷', wbCode: 'BR' },
  { code: 'CAN', name: 'Canada', flag: '🇨🇦', wbCode: 'CA' },
  { code: 'KOR', name: 'South Korea', flag: '🇰🇷', wbCode: 'KR' },
  { code: 'AUS', name: 'Australia', flag: '🇦🇺', wbCode: 'AU' },
  { code: 'IDN', name: 'Indonesia', flag: '🇮🇩', wbCode: 'ID' },
  { code: 'MEX', name: 'Mexico', flag: '🇲🇽', wbCode: 'MX' },
  { code: 'SGP', name: 'Singapore', flag: '🇸🇬', wbCode: 'SG' },
  { code: 'THA', name: 'Thailand', flag: '🇹🇭', wbCode: 'TH' },
  { code: 'MYS', name: 'Malaysia', flag: '🇲🇾', wbCode: 'MY' },
  { code: 'PHL', name: 'Philippines', flag: '🇵🇭', wbCode: 'PH' },
  { code: 'VNM', name: 'Vietnam', flag: '🇻🇳', wbCode: 'VN' },
]

const INDICATORS = [
  { wbId: 'NY.GDP.MKTP.CD', name: 'GDP', transform: (v: number) => `$${(v / 1e9).toFixed(0)}B` },
  { wbId: 'NY.GDP.MKTP.KD.ZG', name: 'GDP Growth', transform: (v: number) => `${v.toFixed(1)}%` },
  { wbId: 'FP.CPI.TOTL', name: 'CPI', transform: (v: number) => v.toFixed(1) },
  { wbId: 'FP.CPI.TOTL.ZG', name: 'Inflation', transform: (v: number) => `${v.toFixed(1)}%` },
  { wbId: 'SL.UEM.TOTL.ZS', name: 'Unemployment', transform: (v: number) => `${v.toFixed(1)}%` },
  { wbId: 'SP.POP.TOTL', name: 'Population', transform: (v: number) => `${(v / 1e6).toFixed(0)}M` },
  { wbId: 'FR.INR.RINR', name: 'Real Interest', transform: (v: number) => `${v.toFixed(1)}%` },
]

export default function GlobalMacroPage() {
  const [data, setData] = useState<Record<string, Record<string, string>>>({})
  const [loading, setLoading] = useState(true)
  const [selectedIndicator, setSelectedIndicator] = useState('GDP Growth')

  useEffect(() => {
    const fetchAll = async () => {
      const results: Record<string, Record<string, string>> = {}

      for (const country of COUNTRIES) {
        results[country.code] = {}
        for (const indicator of INDICATORS) {
          try {
            const url = `https://api.worldbank.org/v2/country/${country.wbCode}/indicator/${indicator.wbId}?format=json&per_page=5`
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
            const json = await res.json()

            if (Array.isArray(json) && json.length >= 2 && Array.isArray(json[1])) {
              const latest = json[1].find((obs: { value: number | null }) => obs.value !== null)
              if (latest) {
                results[country.code][indicator.name] = indicator.transform(latest.value as number)
              }
            }
          } catch {
            // Skip failed fetches
          }
        }
      }

      setData(results)
      setLoading(false)
    }

    fetchAll()
  }, [])

  // Sort countries by selected indicator
  const sortedCountries = [...COUNTRIES].sort((a, b) => {
    const av = data[a.code]?.[selectedIndicator] ?? ''
    const bv = data[b.code]?.[selectedIndicator] ?? ''
    // Extract numeric value for sorting
    const aNum = Number.parseFloat(av.replace(/[^0-9.-]/g, '')) || 0
    const bNum = Number.parseFloat(bv.replace(/[^0-9.-]/g, '')) || 0
    return bNum - aNum
  })

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
          {INDICATORS.map(ind => (
            <button key={ind.name} onClick={() => setSelectedIndicator(ind.name)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                selectedIndicator === ind.name
                  ? 'bg-teal-vivid text-bg-base border-teal-vivid font-bold'
                  : 'bg-bg-panel border-border-dim text-text-muted hover:border-border-active'
              }`}>
              {ind.name}
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
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 font-mono w-8">#</th>
                    <th className="text-left py-2 font-mono">COUNTRY</th>
                    {INDICATORS.map(ind => (
                      <th key={ind.name} className="text-right py-2 font-mono">{ind.name.toUpperCase()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedCountries.map((country, i) => (
                    <tr key={country.code} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-2 font-mono text-text-muted">{i + 1}</td>
                      <td className="py-2 font-mono">
                        <span className="mr-2">{country.flag}</span>
                        <span className="text-text-primary">{country.name}</span>
                      </td>
                      {INDICATORS.map(ind => (
                        <td key={ind.name} className="py-2 text-right font-mono text-text-dim">
                          {data[country.code]?.[ind.name] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
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
            Data is annual (latest available year). For real-time data, FRED (US), ECB (EU), BOJ (Japan) integration is planned.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
