"use client"

import { useState, useEffect } from "react"
import { NexusLayout } from "@/components/layout/NexusLayout"

// Major global indices (US, EU, Asia, EM)
const INDICES = ['^GSPC', '^IXIC', '^DJI', '^VIX', '^FTSE', '^N225', '^HSI', '^STOXX50E', '^JKSE', '^AXJO', '^STI', '^GSPTSE', '^KS11', '^TWII']

// Global equities across ALL major exchanges
const GLOBAL_STOCKS = [
  // US Tech
  { symbol: 'AAPL', name: 'Apple', sector: 'Tech' },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Tech' },
  { symbol: 'GOOGL', name: 'Alphabet', sector: 'Tech' },
  { symbol: 'AMZN', name: 'Amazon', sector: 'Tech' },
  { symbol: 'NVDA', name: 'NVIDIA', sector: 'Tech/Semicon' },
  { symbol: 'TSLA', name: 'Tesla', sector: 'Auto' },
  { symbol: 'META', name: 'Meta', sector: 'Tech' },
  { symbol: 'AMD', name: 'AMD', sector: 'Tech/Semicon' },
  { symbol: 'AVGO', name: 'Broadcom', sector: 'Tech/Semicon' },
  // US Financial
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financial' },
  { symbol: 'GS', name: 'Goldman Sachs', sector: 'Financial' },
  { symbol: 'V', name: 'Visa', sector: 'Financial' },
  { symbol: 'BAC', name: 'Bank of America', sector: 'Financial' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway', sector: 'Financial' },
  // US Healthcare
  { symbol: 'UNH', name: 'UnitedHealth', sector: 'Healthcare' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
  { symbol: 'PFE', name: 'Pfizer', sector: 'Healthcare' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare' },
  // US Energy
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy' },
  { symbol: 'CVX', name: 'Chevron', sector: 'Energy' },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'Energy' },
  // US Consumer
  { symbol: 'WMT', name: 'Walmart', sector: 'Consumer' },
  { symbol: 'NKE', name: 'Nike', sector: 'Consumer' },
  { symbol: 'MCD', name: "McDonald's", sector: 'Consumer' },
  { symbol: 'KO', name: 'Coca-Cola', sector: 'Consumer' },
  { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer' },
  // US Industrials
  { symbol: 'BA', name: 'Boeing', sector: 'Industrials' },
  { symbol: 'CAT', name: 'Caterpillar', sector: 'Industrials' },
  { symbol: 'GE', name: 'GE Aerospace', sector: 'Industrials' },
  { symbol: 'HON', name: 'Honeywell', sector: 'Industrials' },
  // UK (London Stock Exchange)
  { symbol: 'SHEL.L', name: 'Shell (UK)', sector: 'Energy' },
  { symbol: 'AZN.L', name: 'AstraZeneca (UK)', sector: 'Healthcare' },
  { symbol: 'HSBA.L', name: 'HSBC (UK)', sector: 'Financial' },
  { symbol: 'BP.L', name: 'BP (UK)', sector: 'Energy' },
  { symbol: 'ULVR.L', name: 'Unilever (UK)', sector: 'Consumer' },
  { symbol: 'GSK.L', name: 'GSK (UK)', sector: 'Healthcare' },
  // EU
  { symbol: 'SAP.DE', name: 'SAP (Germany)', sector: 'Tech' },
  { symbol: 'TTE.PA', name: 'TotalEnergies (France)', sector: 'Energy' },
  { symbol: 'MC.PA', name: 'LVMH (France)', sector: 'Consumer' },
  { symbol: 'SIE.DE', name: 'Siemens (Germany)', sector: 'Industrials' },
  { symbol: 'NOVN.SW', name: 'Novartis (Switzerland)', sector: 'Healthcare' },
  { symbol: 'ROG.SW', name: 'Roche (Switzerland)', sector: 'Healthcare' },
  { symbol: 'ASML.AS', name: 'ASML (Netherlands)', sector: 'Tech/Semicon' },
  { symbol: 'AIR.PA', name: 'Airbus (France)', sector: 'Industrials' },
  // Japan
  { symbol: '7203.T', name: 'Toyota (Japan)', sector: 'Auto' },
  { symbol: '6758.T', name: 'Sony (Japan)', sector: 'Tech' },
  { symbol: '8306.T', name: 'MUFG (Japan)', sector: 'Financial' },
  { symbol: '9984.T', name: 'SoftBank (Japan)', sector: 'Tech' },
  { symbol: '6861.T', name: 'Keyence (Japan)', sector: 'Industrials' },
  // China/HK
  { symbol: 'BABA', name: 'Alibaba (China)', sector: 'Tech' },
  { symbol: '0700.HK', name: 'Tencent (HK)', sector: 'Tech' },
  { symbol: '9988.HK', name: 'Alibaba (HK)', sector: 'Tech' },
  { symbol: '1810.HK', name: 'Xiaomi (HK)', sector: 'Tech' },
  { symbol: '2318.HK', name: 'Ping An (HK)', sector: 'Financial' },
  { symbol: 'JD', name: 'JD.com (China)', sector: 'Consumer' },
  { symbol: 'PDD', name: 'Pinduoduo (China)', sector: 'Consumer' },
  // Australia
  { symbol: 'BHP.AX', name: 'BHP (Australia)', sector: 'Materials' },
  { symbol: 'CBA.AX', name: 'CBA (Australia)', sector: 'Financial' },
  { symbol: 'CSL.AX', name: 'CSL (Australia)', sector: 'Healthcare' },
  { symbol: 'NAB.AX', name: 'NAB (Australia)', sector: 'Financial' },
  // Singapore
  { symbol: 'D05.SI', name: 'DBS (Singapore)', sector: 'Financial' },
  { symbol: 'O39.SI', name: 'OCBC (Singapore)', sector: 'Financial' },
  { symbol: 'Z74.SI', name: 'Singtel (Singapore)', sector: 'Telecom' },
  // Canada
  { symbol: 'RY.TO', name: 'Royal Bank (Canada)', sector: 'Financial' },
  { symbol: 'TD.TO', name: 'TD Bank (Canada)', sector: 'Financial' },
  { symbol: 'ENB.TO', name: 'Enbridge (Canada)', sector: 'Energy' },
  // India
  { symbol: 'RELIANCE.NS', name: 'Reliance (India)', sector: 'Energy' },
  { symbol: 'TCS.NS', name: 'TCS (India)', sector: 'Tech' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank (India)', sector: 'Financial' },
  // South Korea
  { symbol: '005930.KS', name: 'Samsung (Korea)', sector: 'Tech/Semicon' },
  { symbol: '000660.KS', name: 'SK Hynix (Korea)', sector: 'Tech/Semicon' },
  { symbol: '035420.KS', name: 'Naver (Korea)', sector: 'Tech' },
  // Taiwan
  { symbol: '2330.TW', name: 'TSMC (Taiwan)', sector: 'Tech/Semicon' },
  { symbol: '2317.TW', name: 'Hon Hai (Taiwan)', sector: 'Tech' },
  // Brazil
  { symbol: 'VALE', name: 'Vale (Brazil)', sector: 'Materials' },
  { symbol: 'PBR', name: 'Petrobras (Brazil)', sector: 'Energy' },
  { symbol: 'ITUB', name: 'Itau Unibanco (Brazil)', sector: 'Financial' },
  // Crypto-adjacent
  { symbol: 'MSTR', name: 'MicroStrategy', sector: 'Crypto' },
  { symbol: 'COIN', name: 'Coinbase', sector: 'Crypto' },
  { symbol: 'MARA', name: 'Marathon Digital', sector: 'Crypto' },
  { symbol: 'RIOT', name: 'Riot Platforms', sector: 'Crypto' },
  // IDX (Indonesia Stock Exchange)
  { symbol: 'BBCA.JK', name: 'Bank Central Asia', sector: 'IDX' },
  { symbol: 'BBRI.JK', name: 'Bank Rakyat Indonesia', sector: 'IDX' },
  { symbol: 'BMRI.JK', name: 'Bank Mandiri', sector: 'IDX' },
  { symbol: 'BBNI.JK', name: 'Bank Negara Indonesia', sector: 'IDX' },
  { symbol: 'TLKM.JK', name: 'Telkom Indonesia', sector: 'IDX' },
  { symbol: 'ASII.JK', name: 'Astra International', sector: 'IDX' },
  { symbol: 'GOTO.JK', name: 'GoTo Gojek Tokopedia', sector: 'IDX' },
  { symbol: 'ADRO.JK', name: 'Adaro Energy', sector: 'IDX' },
  { symbol: 'ANTM.JK', name: 'Aneka Tambang', sector: 'IDX' },
  { symbol: 'MDKA.JK', name: 'Merdeka Copper Gold', sector: 'IDX' },
]

export default function EquitiesPage() {
  const [quotes, setQuotes] = useState<Record<string, { price: number; change: number; name: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const allSymbols = GLOBAL_STOCKS.map(s => s.symbol).join(',')
    fetch(`/api/v1/equities?symbols=${allSymbols}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, { price: number; change: number; name: string }> = {}
        for (const q of d.data?.stocks ?? []) {
          map[q.symbol] = { price: q.price, change: q.changePercent, name: q.name ?? q.symbol }
        }
        for (const q of d.data?.indices ?? []) {
          map[q.symbol] = { price: q.price, change: q.changePercent, name: q.name ?? q.symbol }
        }
        setQuotes(map)
        setLoading(false)
      })
      .catch((err) => { setLoading(false); setError((err as Error).message) })
  }, [])

  // Group stocks by sector for display
  const sectors = [...new Set(GLOBAL_STOCKS.map(s => s.sector))]

  return (
    <NexusLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold font-mono text-accent-cyan">GLOBAL EQUITIES</h1>
          <span className="text-[10px] text-text-muted font-mono">{GLOBAL_STOCKS.length} stocks · {INDICES.length} indices · 14 exchanges</span>
        </div>
        {error && <div className="text-data-bear text-[11px] font-mono p-4">Error: {error}</div>}

        {/* Indices */}
        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-3">MAJOR INDICES</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {INDICES.map(sym => {
              const q = quotes[sym]
              return (
                <div key={sym} className="p-2">
                  <p className="text-[10px] text-text-muted">{q?.name ?? sym}</p>
                  <p className="text-lg font-mono font-bold">{q?.price?.toFixed(2) ?? '—'}</p>
                  <p className={`text-xs font-mono ${(q?.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                    {q?.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* All Stocks by Sector */}
        {loading ? (
          <div className="text-text-dim text-xs p-8 text-center">Loading Yahoo Finance data for {GLOBAL_STOCKS.length} symbols...</div>
        ) : (
          sectors.map(sector => {
            const stocks = GLOBAL_STOCKS.filter(s => s.sector === sector).filter(s => quotes[s.symbol])
            if (stocks.length === 0) return null
            return (
              <div key={sector} className="bg-bg-panel border border-border-dim rounded-lg p-4">
                <h2 className="text-xs font-mono text-accent-cyan mb-3">{sector.toUpperCase()}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-text-muted border-b border-border-dim">
                        <th className="text-left py-2 font-mono w-20">SYMBOL</th>
                        <th className="text-left py-2 font-mono">NAME</th>
                        <th className="text-right py-2 font-mono w-24">PRICE</th>
                        <th className="text-right py-2 font-mono w-20">CHANGE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stocks.map(s => {
                        const q = quotes[s.symbol]
                        if (!q) return null
                        return (
                          <tr key={s.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                            <td className="py-2 font-mono text-accent-cyan">{s.symbol}</td>
                            <td className="py-2 text-text-dim">{s.name}</td>
                            <td className="py-2 text-right font-mono">{q.price?.toFixed(2) ?? '—'}</td>
                            <td className={`py-2 text-right font-mono ${(q.change ?? 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                              {q.change != null ? `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}%` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })
        )}
      </div>
    </NexusLayout>
  )
}
