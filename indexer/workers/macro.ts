// ─────────────────────────────────────────────────────────────
// Macro Worker — Macro Regime & On-Chain Macro Data
// FRED (US macro) + CoinMetrics (crypto-native macro)
// Outputs: MacroDataPoint, CycleIndicatorSnapshot, regime signals
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db";
import { publishEvent } from "../publisher";
import { fetchWithRetry } from "../integrations/http-client";
import { type IntegrationConfig } from "../integrations/config";

const FRED_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour (macro changes slowly)
const COINMETRICS_SYNC_INTERVAL = 15 * 60 * 1000; // 15 minutes

// FRED Series IDs for key macro indicators
const FRED_SERIES = {
  // Monetary
  FEDFUNDS: "FEDFUNDS",           // Effective Federal Funds Rate
  DFF: "DFF",                      // Daily Federal Funds Rate
  M2SL: "M2SL",                    // M2 Money Stock
  WALCL: "WALCL",                  // Fed Total Assets
  RRPONTSYD: "RRPONTSYD",          // Reverse Repo Operations

  // Inflation
  CPIAUCSL: "CPIAUCSL",            // CPI All Items
  CPILFESL: "CPILFESL",            // Core CPI
  PCEPI: "PCEPI",                  // PCE Price Index

  // Labor
  UNRATE: "UNRATE",                // Unemployment Rate
  PAYEMS: "PAYEMS",                // Nonfarm Payrolls
  CIVPART: "CIVPART",              // Labor Force Participation

  // Growth
  GDPC1: "GDPC1",                  // Real GDP
  INDPRO: "INDPRO",                // Industrial Production
  RETAILx: "RETAILx",              // Retail Sales

  // Financial
  T10Y2Y: "T10Y2Y",                // 10Y-2Y Spread
  T10Y3M: "T10Y3M",                // 10Y-3M Spread
  BAA10Y: "BAA10Y",                // BAA Corporate Yield - 10Y
  VIXCLS: "VIXCLS",                // VIX Close

  // Dollar
  DTWEXBGS: "DTWEXBGS",            // Broad Dollar Index
} as const;

interface FredObservation {
  realtime_start: string;
  realtime_end: string;
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

// CoinMetrics asset codes
const CM_ASSETS = ["btc", "eth", "sol", "arb", "op", "matic", "avax"] as const;

interface CoinMetricsMetric {
  asset: string;
  time: string;
  [key: string]: string | number | undefined;
}

// Key CoinMetrics metrics to track
const CM_METRICS = [
  "PriceUSD",
  "RealizedCapUSD",
  "MVRVRatio",
  "NUPL",
  "SOPR",
  "HashRate",
  "Difficulty",
  "BlkCnt",
  "TxCnt",
  "AdrActCnt",
  "FeeTotUSD",
  "RevUSD",
  "SplyCur",
  "SplyFF",
  "CapRealUSD",
  "CapMrktCurUSD",
  "FlowInExUSD",
  "FlowOutExUSD",
  "NetFlowExUSD",
] as const;

export function startMacroWorker(config: IntegrationConfig): void {
  console.log("[macro] starting macro worker");

  const fredKey = process.env.FRED_API_KEY;
  const cmKey = process.env.COINMETRICS_API_KEY;

  if (!fredKey && !cmKey) {
    console.log("[macro] No API keys configured (FRED_API_KEY, COINMETRICS_API_KEY)");
    return;
  }

  if (fredKey) {
    console.log("[macro] FRED loop started (every 1hr)");
    runFredLoop(config, fredKey);
  }

  if (cmKey) {
    console.log("[macro] CoinMetrics loop started (every 15min)");
    runCoinMetricsLoop(config, cmKey);
  }
}

async function runFredLoop(config: IntegrationConfig, apiKey: string): Promise<void> {
  try {
    await fetchFredData(config, apiKey);
  } catch (err) {
    console.error("[macro:fred] loop error:", (err as Error).message);
  }

  setTimeout(() => runFredLoop(config, apiKey), FRED_SYNC_INTERVAL);
}

async function fetchFredData(config: IntegrationConfig, apiKey: string): Promise<void> {
  const results: Array<{ seriesId: string; value: number; date: string }> = [];

  for (const [, seriesId] of Object.entries(FRED_SERIES)) {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&limit=1&sort_order=desc`;

      const response = await fetchWithRetry<FredResponse>(url, {
        maxRetries: 2,
        timeoutMs: 15_000,
      });

      const latest = response.observations?.[0];
      if (latest && latest.value !== ".") {
        const value = parseFloat(latest.value);
        if (!isNaN(value)) {
          // Store in MacroDataPoint
          await prisma.macroDataPoint.upsert({
            where: { seriesId_date: { seriesId, date: new Date(latest.date) } },
            create: { seriesId, sourceId: "fred", value, date: new Date(latest.date) },
            update: { value },
          });

          results.push({ seriesId, value, date: latest.date });
        }
      }
    } catch (err) {
      console.error(`[macro:fred] failed for ${seriesId}:`, (err as Error).message);
    }
  }

  // Compute regime indicators
  const regime = computeRegime(results);

  // Publish macro update
  if (results.length > 0) {
    await publishEvent("nexus:macro", {
      source: "fred",
      type: "macro_update",
      indicators: results,
      regime,
      timestamp: new Date().toISOString(),
    });
    console.log(`[macro:fred] published ${results.length} indicators, regime: ${regime.label}`);
  }
}

async function runCoinMetricsLoop(config: IntegrationConfig, apiKey: string): Promise<void> {
  try {
    await fetchCoinMetricsData(config, apiKey);
  } catch (err) {
    console.error("[macro:cm] loop error:", (err as Error).message);
  }

  setTimeout(() => runCoinMetricsLoop(config, apiKey), COINMETRICS_SYNC_INTERVAL);
}

async function fetchCoinMetricsData(config: IntegrationConfig, apiKey: string): Promise<void> {
  const assets = CM_ASSETS.join(",");
  const metrics = CM_METRICS.join(",");

  const url = `https://api.coinmetrics.io/v4/timeseries/asset-metrics?assets=${assets}&metrics=${metrics}&frequency=1d&page_size=1&pretty=false`;

  try {
    const response = await fetchWithRetry<{ data: CoinMetricsMetric[] }>(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      maxRetries: 2,
      timeoutMs: 20_000,
    });

    const data = response.data ?? [];
    const snapshots = [];

    for (const metric of data) {
      const asset = metric.asset.toUpperCase();

      // Store key cycle indicators
      const indicators = [
        { indicator: "mvrv", value: metric.MVRVRatio },
        { indicator: "nupl", value: metric.NUPL },
        { indicator: "sopr", value: metric.SOPR },
        { indicator: "hashrate", value: metric.HashRate },
        { indicator: "active_addresses", value: metric.AdrActCnt },
        { indicator: "fees_usd", value: metric.FeeTotUSD },
        { indicator: "revenue_usd", value: metric.RevUSD },
        { indicator: "net_exchange_flow", value: metric.NetFlowExUSD },
      ];

      for (const ind of indicators) {
        if (ind.value !== undefined && ind.value !== null) {
          const numValue = typeof ind.value === "string" ? parseFloat(ind.value) : ind.value;
          if (!isNaN(numValue)) {
            await prisma.cycleIndicatorSnapshot.create({
              data: {
                indicator: ind.indicator,
                value: numValue,
                zone: classifyZone(ind.indicator, numValue, asset),
                timestamp: new Date(metric.time),
              },
            });

            snapshots.push({ asset, indicator: ind.indicator, value: numValue, zone: classifyZone(ind.indicator, numValue, asset) });
          }
        }
      }
    }

    if (snapshots.length > 0) {
      await publishEvent("nexus:macro", {
        source: "coinmetrics",
        type: "cycle_indicators",
        indicators: snapshots,
        timestamp: new Date().toISOString(),
      });
      console.log(`[macro:cm] published ${snapshots.length} cycle indicators`);
    }
  } catch (err) {
    console.error("[macro:cm] fetch failed:", (err as Error).message);
  }
}

function computeRegime(indicators: Array<{ seriesId: string; value: number }>): { label: string; score: number } {
  // Simple regime scoring based on key indicators
  let score = 0;
  let factors = 0;

  const map = Object.fromEntries(indicators.map((i) => [i.seriesId, i.value]));

  // Yield curve (10Y-2Y): inverted = recession risk
  if (map.T10Y2Y !== undefined) {
    if (map.T10Y2Y < 0) score -= 2; // Inverted
    else if (map.T10Y2Y > 1) score += 1; // Steep
    factors++;
  }

  // VIX: high = fear
  if (map.VIXCLS !== undefined) {
    if (map.VIXCLS > 30) score -= 2;
    else if (map.VIXCLS < 15) score += 1;
    factors++;
  }

  // Dollar: strong = risk-off
  if (map.DTWEXBGS !== undefined) {
    // Compare to 1-year ago (simplified)
    score += map.DTWEXBGS > 120 ? -1 : 0;
    factors++;
  }

  // Fed Funds: high = tight
  if (map.FEDFUNDS !== undefined) {
    score += map.FEDFUNDS > 5 ? -1 : map.FEDFUNDS < 1 ? 1 : 0;
    factors++;
  }

  // M2 growth: declining = tight
  // Would need YoY comparison

  const normalized = factors > 0 ? score / factors : 0;

  let label = "neutral";
  if (normalized > 0.5) label = "risk_on";
  else if (normalized < -0.5) label = "risk_off";
  else if (normalized > 0) label = "slightly_risk_on";
  else if (normalized < 0) label = "slightly_risk_off";

  return { label, score: normalized };
}

function classifyZone(indicator: string, value: number, _asset: string): string {
  const zones: Record<string, { euphoria: number; bull: number; neutral: number; accumulation: number; capitulation: number }> = {
    mvrv: { euphoria: 3.5, bull: 2.0, neutral: 1.0, accumulation: 0.7, capitulation: 0 },
    nupl: { euphoria: 0.7, bull: 0.4, neutral: 0, accumulation: -0.3, capitulation: -1 },
    sopr: { euphoria: 1.1, bull: 1.02, neutral: 1.0, accumulation: 0.98, capitulation: 0.95 },
    hashrate: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 }, // Trend-based
    active_addresses: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
    fees_usd: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
    revenue_usd: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
    net_exchange_flow: { euphoria: 0, bull: 0, neutral: 0, accumulation: 0, capitulation: 0 },
  };

  const z = zones[indicator];
  if (!z) return "neutral";

  if (value >= z.euphoria) return "euphoria";
  if (value >= z.bull) return "bull";
  if (value >= z.neutral) return "neutral";
  if (value >= z.accumulation) return "accumulation";
  return "capitulation";
}

/**
 * Get current macro regime for position sizing
 */
export async function getCurrentRegime(): Promise<{
  regime: string;
  score: number;
  fredIndicators: Record<string, number>;
  cmIndicators: Record<string, number>;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [fredData, cmData] = await Promise.all([
    prisma.macroDataPoint.findMany({
      where: { sourceId: "fred", date: { gte: since } },
      orderBy: { date: "desc" },
      distinct: ["seriesId"],
    }),
    prisma.cycleIndicatorSnapshot.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: "desc" },
      distinct: ["indicator"],
    }),
  ]);

  const fredIndicators = Object.fromEntries(fredData.map((d) => [d.seriesId, d.value]));
  const cmIndicators = Object.fromEntries(cmData.map((d) => [d.indicator, d.value]));

  const regime = computeRegime(Object.entries(fredIndicators).map(([k, v]) => ({ seriesId: k, value: v })));

  return { regime: regime.label, score: regime.score, fredIndicators, cmIndicators };
}

export async function healthCheck(_config: IntegrationConfig): Promise<{
  ok: boolean;
  fredAvailable: boolean;
  cmAvailable: boolean;
  error?: string;
}> {
  const fredOk = !!process.env.FRED_API_KEY;
  const cmOk = !!process.env.COINMETRICS_API_KEY;
  return { ok: fredOk || cmOk, fredAvailable: fredOk, cmAvailable: cmOk };
}