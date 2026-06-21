// ─────────────────────────────────────────────────────────────
// Commodity & Ticker Mapper
// Maps weather anomalies in specific regions to affected commodities
// and their associated tradeable tickers.
// ─────────────────────────────────────────────────────────────

// ─── Region → Commodity Mapping ────────────────────────────

export interface CommodityMapping {
  commodity: string
  tickers: string[]
  description: string
}

const REGION_COMMODITY_MAP: Record<string, CommodityMapping[]> = {
  sumatra: [
    {
      commodity: 'Palm Oil (CPO)',
      tickers: ['KLSE:FGV', 'KLSE:SIME', 'IDX:AALI', 'IDX:LSIP', 'PALLM.MY'],
      description: 'Indonesia/Malaysia palm oil — drought/flood directly impacts supply',
    },
    {
      commodity: 'Rubber',
      tickers: ['KLSE:TOPGLOV', 'KLSE:KOSSAN'],
      description: 'Southeast Asian rubber plantations weather-sensitive',
    },
  ],

  texas: [
    {
      commodity: 'WTI Crude Oil',
      tickers: ['CL=F', 'USO', 'XLE', 'XOM', 'CVX', 'COP'],
      description: 'Gulf Coast refining capacity, offshore production weather exposure',
    },
    {
      commodity: 'Natural Gas',
      tickers: ['NG=F', 'UNG', 'LNG', 'EOG', 'DVN'],
      description: 'Permian Basin production and pipeline freeze-offs',
    },
    {
      commodity: 'Electricity',
      tickers: ['VST', 'CEG', 'NRG', 'NEE'],
      description: 'Texas grid (ERCOT) extreme weather sensitivity',
    },
  ],

  'black-sea': [
    {
      commodity: 'Wheat',
      tickers: ['ZW=F', 'WEAT', 'CORN'],
      description: 'Russia/Ukraine wheat export corridor — drought/frost disruption',
    },
    {
      commodity: 'Corn',
      tickers: ['ZC=F', 'CORN', 'DBA'],
      description: 'Ukrainian corn exports through Black Sea ports',
    },
    {
      commodity: 'Sunflower Oil',
      tickers: ['ADM', 'BG'],
      description: 'Major sunflower growing region globally',
    },
  ],

  midwest: [
    {
      commodity: 'Corn',
      tickers: ['ZC=F', 'CORN', 'DBA', 'ADM'],
      description: 'US Corn Belt — planting/harvest weather critical',
    },
    {
      commodity: 'Soybeans',
      tickers: ['ZS=F', 'SOYB', 'BG'],
      description: 'US soybean production weather dependent',
    },
  ],

  india: [
    {
      commodity: 'Sugar',
      tickers: ['SB=F', 'SGG', 'BAL'],
      description: 'India is #2 sugar producer — monsoon dependent',
    },
    {
      commodity: 'Cotton',
      tickers: ['CT=F', 'BAL'],
      description: 'India cotton production rainfall sensitive',
    },
    {
      commodity: 'Rice',
      tickers: ['RICE', 'DBA'],
      description: 'India rice exports — monsoon-driven',
    },
  ],
}

// ─── Commodity → Ticker Reverse Map ───────────────────────

const COMMODITY_TICKER_MAP: Record<string, string[]> = {}

for (const mappings of Object.values(REGION_COMMODITY_MAP)) {
  for (const m of mappings) {
    const existing = COMMODITY_TICKER_MAP[m.commodity] ?? []
    // Deduplicate tickers
    const merged = [...new Set([...existing, ...m.tickers])]
    COMMODITY_TICKER_MAP[m.commodity] = merged
  }
}

// ─── Exports ───────────────────────────────────────────────

/**
 * Get commodities affected by a weather anomaly in a given region.
 */
export function getAffectedCommodities(
  region: string,
  anomaly?: { metric: string; zScore: number },
): CommodityMapping[] {
  const mappings = REGION_COMMODITY_MAP[region]
  if (!mappings) return []

  // If anomaly is severe (|z| ≥ 2.5), filter to most exposed commodities
  if (anomaly && Math.abs(anomaly.zScore) >= 2.5) {
    // For precipitation: drought-sensitive crops (palm oil, wheat, sugar) first
    // For temperature: all crops affected
    if (anomaly.metric === 'precipitation_sum' && anomaly.zScore < -2) {
      return mappings.filter((m) =>
        /palm|wheat|sugar|cotton|rice|corn/i.test(m.commodity),
      )
    }
  }

  return mappings
}

/**
 * Get all tickers affected by a specific commodity.
 */
export function getAffectedTickers(commodity: string): string[] {
  return COMMODITY_TICKER_MAP[commodity] ?? []
}

/**
 * Get all available region keys.
 */
export function getAvailableRegions(): string[] {
  return Object.keys(REGION_COMMODITY_MAP)
}
