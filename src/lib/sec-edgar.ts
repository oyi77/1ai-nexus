// ─── SEC EDGAR Client ─────────────────────────────────────
// Fetches 20+ years of company financials from SEC EDGAR.
// Free, no API key required. Rate limit: 10 requests/second.
// ─────────────────────────────────────────────────────────

const EDGAR_BASE = 'https://data.sec.gov'
const USER_AGENT = '1ai-nexus/1.0 (contact@1ai-nexus.com)'

export interface EdgarCompany {
  cik: string
  name: string
  ticker: string
}

export interface Filing {
  date: string
  form: string
  description: string
  url: string
}

export interface FinancialData {
  period: string
  revenue: number | null
  netIncome: number | null
  totalAssets: number | null
  totalLiabilities: number | null
  totalEquity: number | null
  operatingCashFlow: number | null
  capitalExpenditure: number | null
  freeCashFlow: number | null
}

// Pre-populated CIK numbers for major companies
const CIK_MAP: Record<string, string> = {
  'AAPL': '0000320193', 'MSFT': '0000789019', 'GOOGL': '0001652044',
  'AMZN': '0001018724', 'NVDA': '0001045810', 'META': '0001326801',
  'TSLA': '0001318605', 'JPM': '0000019617', 'V': '0001403161',
  'JNJ': '0000200406', 'WMT': '0000104169', 'PG': '0000080424',
  'XOM': '0000034088', 'CVX': '0000093410', 'UNH': '0000731766',
  'HD': '0000354950', 'DIS': '0001001039', 'NFLX': '0001065280',
  'BA': '0000012927', 'GS': '0000886982', 'BAC': '0000070858',
  'INTC': '0000050863', 'AMD': '0000002488', 'CSCO': '0000858877',
  'PEP': '0000077476', 'KO': '0000021344', 'MCD': '0000063908',
  'NKE': '0000320187', 'ABT': '0000001800', 'MRK': '0000310158',
  'PFE': '0000078003', 'LLY': '0000059478', 'ABBV': '0001551152',
  'AVGO': '0001730168', 'COST': '0000909832', 'ORCL': '0001341439',
  'CRM': '0001108524', 'TXN': '0000097476', 'QCOM': '0000804328',
  'IBM': '0000051143', 'F': '0000037996', 'GM': '0001467858',
  'GE': '0000040545', 'CAT': '0000018230', 'MMM': '0000066740',
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`EDGAR ${res.status}`)
  return res.json()
}

/**
 * Get company CIK number from ticker symbol
 */
export function getCIK(ticker: string): string | null {
  return CIK_MAP[ticker.toUpperCase()] ?? null
}

/**
 * Get company filings from EDGAR
 */
export async function getFilings(ticker: string): Promise<Filing[]> {
  const cik = getCIK(ticker)
  if (!cik) return []

  try {
    const data = await fetchJson(`${EDGAR_BASE}/submissions/CIK${cik}.json`) as Record<string, unknown>
    const filings = data.filings as { recent: { form: string[]; filingDate: string[]; primaryDocument: string[]; description: string[] } }
    const recent = filings.recent

    const result: Filing[] = []
    for (let i = 0; i < Math.min(recent.form.length, 50); i++) {
      result.push({
        date: recent.filingDate[i],
        form: recent.form[i],
        description: recent.description[i] ?? '',
        url: `https://www.sec.gov/Archives/edgar/data/${cik}/${recent.primaryDocument[i]}`,
      })
    }
    return result
  } catch {
    return []
  }
}

/**
 * Get financial data from EDGAR XBRL
 */
export async function getFinancials(ticker: string): Promise<FinancialData[]> {
  const cik = getCIK(ticker)
  if (!cik) return []

  try {
    const data = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`) as Record<string, unknown>
    const facts = data.facts as Record<string, unknown>
    const gaap = facts['us-gaap'] as Record<string, unknown> | undefined
    if (!gaap) return []

    // Helper to extract annual values
    const extractAnnual = (field: unknown): Map<string, number> => {
      const map = new Map<string, number>()
      if (!field || typeof field !== 'object') return map
      const f = field as { units?: Record<string, Array<{ end: string; val: number; form: string }>> }
      if (!f.units) return map
      const usd = f.units.USD ?? f.units['USD/shares'] ?? f.units.shares ?? []
      for (const item of usd) {
        if (item.form === '10-K') {
          const year = item.end.substring(0, 4)
          map.set(year, item.val)
        }
      }
      return map
    }

    const revenue = extractAnnual(gaap.Revenues)
    const netIncome = extractAnnual(gaap.NetIncomeLoss)
    const assets = extractAnnual(gaap.Assets)
    const liabilities = extractAnnual(gaap.Liabilities)
    const equity = extractAnnual(gaap.StockholdersEquity)
    const operatingCF = extractAnnual(gaap.OperatingCashFlow)
    const capex = extractAnnual(gaap.PaymentsToAcquirePropertyPlantAndEquipment)

    // Get all years
    const years = new Set<string>()
    for (const map of [revenue, netIncome, assets, liabilities, equity, operatingCF, capex]) {
      for (const year of map.keys()) years.add(year)
    }

    const result: FinancialData[] = []
    for (const year of [...years].sort().reverse()) {
      const rev = revenue.get(year) ?? null
      const ni = netIncome.get(year) ?? null
      const ocf = operatingCF.get(year) ?? null
      const cx = capex.get(year) ?? null

      result.push({
        period: year,
        revenue: rev,
        netIncome: ni,
        totalAssets: assets.get(year) ?? null,
        totalLiabilities: liabilities.get(year) ?? null,
        totalEquity: equity.get(year) ?? null,
        operatingCashFlow: ocf,
        capitalExpenditure: cx,
        freeCashFlow: ocf != null && cx != null ? ocf - cx : null,
      })
    }

    return result
  } catch {
    return []
  }
}

/**
 * Get all available tickers with CIK numbers
 */
export function getAvailableTickers(): string[] {
  return Object.keys(CIK_MAP).sort()
}
