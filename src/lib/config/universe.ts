// ─────────────────────────────────────────────────────────────
// Universe config — THE single source of truth for curated
// symbol sets used across pages and API routes.
//
// Rules:
//  - Pages/routes MUST import from here. Inline symbol arrays in
//    components are prohibited (they were duplicated across ~15
//    files and drifted independently).
//  - IDX coverage: IDX_FALLBACK is only the offline floor. The
//    live universe comes from market/provider/idx-universe
//    (idx.co.id → data/idx/universe.json → this fallback).
// ─────────────────────────────────────────────────────────────

export interface UniverseStock {
  symbol: string
  name: string
  sector?: string
  exchange?: string
}

export interface CommodityItem {
  symbol: string
  name: string
  unit: string
}

// Major global indices (US, EU, Asia, EM)
export const INDICES = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^DJI', name: 'Dow Jones' },
  { symbol: '^VIX', name: 'VIX' },
  { symbol: '^FTSE', name: 'FTSE 100' },
  { symbol: '^N225', name: 'Nikkei 225' },
  { symbol: '^HSI', name: 'Hang Seng' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50' },
  { symbol: '^JKSE', name: 'IHSG' },
  { symbol: '^AXJO', name: 'All Ordinaries' },
  { symbol: '^STI', name: 'STI Index' },
  { symbol: '^GSPTSE', name: 'S&P/TSX' },
  { symbol: '^KS11', name: 'KOSPI' },
  { symbol: '^TWII', name: 'TAIEX' },
] as const

export const INDEX_SYMBOLS: string[] = INDICES.map((i) => i.symbol)

// Global equities across ALL major exchanges (equities page)
export const GLOBAL_STOCKS: UniverseStock[] = [
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

// Offline IDX floor — used only when both the live source and the
// snapshot are unavailable. Do not extend per-feature; refresh the
// snapshot instead (npm run harvest:idx-universe).
export const IDX_FALLBACK: UniverseStock[] = GLOBAL_STOCKS.filter((s) => s.sector === 'IDX')

// Heatmap tiles (heatmap page)
export const HEATMAP_STOCKS: UniverseStock[] = [
  // US Tech
  { symbol: 'AAPL', name: 'Apple', sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Technology' },
  { symbol: 'GOOGL', name: 'Alphabet', sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon', sector: 'Technology' },
  { symbol: 'NVDA', name: 'NVIDIA', sector: 'Technology' },
  { symbol: 'META', name: 'Meta', sector: 'Technology' },
  { symbol: 'TSLA', name: 'Tesla', sector: 'Technology' },
  { symbol: 'NFLX', name: 'Netflix', sector: 'Technology' },
  { symbol: 'AMD', name: 'AMD', sector: 'Technology' },
  { symbol: 'CRM', name: 'Salesforce', sector: 'Technology' },
  // US Financial
  { symbol: 'JPM', name: 'JPMorgan', sector: 'Financial' },
  { symbol: 'GS', name: 'Goldman Sachs', sector: 'Financial' },
  { symbol: 'V', name: 'Visa', sector: 'Financial' },
  { symbol: 'MA', name: 'Mastercard', sector: 'Financial' },
  { symbol: 'BAC', name: 'Bank of America', sector: 'Financial' },
  // US Healthcare
  { symbol: 'UNH', name: 'UnitedHealth', sector: 'Healthcare' },
  { symbol: 'JNJ', name: 'J&J', sector: 'Healthcare' },
  { symbol: 'LLY', name: 'Eli Lilly', sector: 'Healthcare' },
  { symbol: 'PFE', name: 'Pfizer', sector: 'Healthcare' },
  // US Energy
  { symbol: 'XOM', name: 'Exxon', sector: 'Energy' },
  { symbol: 'CVX', name: 'Chevron', sector: 'Energy' },
  // US Consumer
  { symbol: 'WMT', name: 'Walmart', sector: 'Consumer' },
  { symbol: 'KO', name: 'Coca-Cola', sector: 'Consumer' },
  { symbol: 'PG', name: 'P&G', sector: 'Consumer' },
  { symbol: 'MCD', name: "McDonald's", sector: 'Consumer' },
  // IDX
  { symbol: 'BBCA.JK', name: 'BCA', sector: 'IDX' },
  { symbol: 'BBRI.JK', name: 'BRI', sector: 'IDX' },
  { symbol: 'BMRI.JK', name: 'Mandiri', sector: 'IDX' },
  { symbol: 'TLKM.JK', name: 'Telkom', sector: 'IDX' },
  { symbol: 'GOTO.JK', name: 'GoTo', sector: 'IDX' },
  { symbol: 'ASII.JK', name: 'Astra', sector: 'IDX' },
]

// Screener universe (screener page + /api/v1/screener)
export const SCREENER_STOCKS: Required<Pick<UniverseStock, 'symbol' | 'name' | 'sector' | 'exchange'>>[] = [
  // US Large Cap
  { symbol: 'AAPL', name: 'Apple', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'GOOGL', name: 'Alphabet', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'AMZN', name: 'Amazon', sector: 'Consumer', exchange: 'NASDAQ' },
  { symbol: 'NVDA', name: 'NVIDIA', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'META', name: 'Meta', sector: 'Technology', exchange: 'NASDAQ' },
  { symbol: 'TSLA', name: 'Tesla', sector: 'Automotive', exchange: 'NASDAQ' },
  { symbol: 'NFLX', name: 'Netflix', sector: 'Media', exchange: 'NASDAQ' },
  { symbol: 'COST', name: 'Costco', sector: 'Consumer', exchange: 'NASDAQ' },
  { symbol: 'JPM', name: 'JPMorgan Chase', sector: 'Financial', exchange: 'NYSE' },
  { symbol: 'V', name: 'Visa', sector: 'Financial', exchange: 'NYSE' },
  { symbol: 'GS', name: 'Goldman Sachs', sector: 'Financial', exchange: 'NYSE' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', exchange: 'NYSE' },
  { symbol: 'WMT', name: 'Walmart', sector: 'Consumer', exchange: 'NYSE' },
  { symbol: 'XOM', name: 'Exxon Mobil', sector: 'Energy', exchange: 'NYSE' },
  { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer', exchange: 'NYSE' },
  { symbol: 'UNH', name: 'UnitedHealth', sector: 'Healthcare', exchange: 'NYSE' },
  { symbol: 'HD', name: 'Home Depot', sector: 'Consumer', exchange: 'NYSE' },
  { symbol: 'DIS', name: 'Disney', sector: 'Media', exchange: 'NYSE' },
  { symbol: 'BA', name: 'Boeing', sector: 'Industrial', exchange: 'NYSE' },
  // IDX Blue Chips
  { symbol: 'BBCA.JK', name: 'Bank Central Asia', sector: 'Financial', exchange: 'IDX' },
  { symbol: 'BBRI.JK', name: 'Bank Rakyat Indonesia', sector: 'Financial', exchange: 'IDX' },
  { symbol: 'BMRI.JK', name: 'Bank Mandiri', sector: 'Financial', exchange: 'IDX' },
  { symbol: 'TLKM.JK', name: 'Telkom Indonesia', sector: 'Telecom', exchange: 'IDX' },
  { symbol: 'ASII.JK', name: 'Astra International', sector: 'Industrial', exchange: 'IDX' },
  { symbol: 'GOTO.JK', name: 'GoTo Gojek Tokopedia', sector: 'Technology', exchange: 'IDX' },
  // EU
  { symbol: 'SAP.DE', name: 'SAP', sector: 'Technology', exchange: 'XETRA' },
  { symbol: 'MC.PA', name: 'LVMH', sector: 'Consumer', exchange: 'Euronext' },
  { symbol: 'TTE.PA', name: 'TotalEnergies', sector: 'Energy', exchange: 'Euronext' },
  // Asia
  { symbol: '7203.T', name: 'Toyota', sector: 'Automotive', exchange: 'TSE' },
  { symbol: '0700.HK', name: 'Tencent', sector: 'Technology', exchange: 'HKEX' },
  { symbol: 'BABA', name: 'Alibaba', sector: 'Technology', exchange: 'NYSE' },
]

// Financials + fundamentals analysis watchlist (identical 20-symbol set)
export const ANALYSIS_WATCHLIST = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ',
  'BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'TLKM.JK', 'GOTO.JK',
  'SAP.DE', 'MC.PA', '0700.HK', 'BABA', '7203.T',
] as const

// Default quote set for /api/v1/equities (no ?symbols= given)
export const EQUITIES_DEFAULT_SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'AMD', 'AVGO',
  'JPM', 'GS', 'V', 'BAC', 'BRK-B', 'UNH', 'JNJ', 'PFE', 'LLY',
  'XOM', 'CVX', 'WMT', 'KO', 'PG', 'SAP.DE', 'MC.PA', '7203.T', 'BABA',
  '0700.HK', 'BHP.AX', 'D05.SI', 'RELIANCE.NS', '005930.KS', '2330.TW',
  'VALE', 'PBR', 'BBCA.JK', 'BBRI.JK', 'BMRI.JK', 'TLKM.JK', 'ADRO.JK',
] as const

// Comparables peer groups (comps page + /api/v1/equities/universe?group=)
export const PEER_GROUPS: Record<string, { name: string; symbols: string[] }> = {
  'us-banks': { name: 'US Banks', symbols: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C'] },
  'us-tech': { name: 'US Big Tech', symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA'] },
  'us-healthcare': { name: 'US Healthcare', symbols: ['UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK'] },
  'us-energy': { name: 'US Energy', symbols: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY'] },
  'global-luxury': { name: 'Global Luxury', symbols: ['MC.PA', 'RMS.DE', 'CFR.SW', 'EL', 'COTY', 'TPR'] },
  'ev-battery': { name: 'EV & Battery', symbols: ['TSLA', 'NIO', 'RIVN', 'LCID', 'BYDDY', '1211.HK'] },
}

// IDX peer groups are DERIVED from the live universe at serve time
// (sector/industry predicates over market/provider/idx-universe),
// NOT stored as symbol lists — membership follows the market.
export const IDX_DERIVED_GROUPS: Record<string, { name: string; sector: string; industry?: string }> = {
  'idx-banks': { name: 'IDX Banks', sector: 'Finance', industry: 'banks' }, // TV splits banks into Major/Regional
  'idx-telecom': { name: 'IDX Telecom', sector: 'Communications' },
}

// Display registry for peer-group tabs (curated + derived)
export const PEER_GROUP_NAMES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PEER_GROUPS).map(([id, g]) => [id, g.name])),
  ...Object.fromEntries(Object.entries(IDX_DERIVED_GROUPS).map(([id, g]) => [id, g.name])),
}

// Chart quick-picks (charts page)
export const CHART_SYMBOLS = [
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'ETH-USD', name: 'Ethereum' },
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'BBCA.JK', name: 'BCA' },
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'GLD', name: 'Gold' },
] as const

export interface DcfPreset {
  symbol: string
  name: string
  fcf: number
  growth5y: number
  growth10y: number
  shares: number
  debt: number
  price: number
}

// DCF starter presets (dcf page) — editable input defaults, not data
export const DCF_PRESETS: DcfPreset[] = [
  { symbol: 'AAPL', name: 'Apple', fcf: 110e9, growth5y: 0.08, growth10y: 0.05, shares: 15.2e9, debt: 100e9, price: 195 },
  { symbol: 'MSFT', name: 'Microsoft', fcf: 70e9, growth5y: 0.12, growth10y: 0.08, shares: 7.4e9, debt: 50e9, price: 450 },
  { symbol: 'GOOGL', name: 'Alphabet', fcf: 80e9, growth5y: 0.10, growth10y: 0.07, shares: 12.5e9, debt: 30e9, price: 175 },
  { symbol: 'AMZN', name: 'Amazon', fcf: 55e9, growth5y: 0.15, growth10y: 0.10, shares: 10.3e9, debt: 150e9, price: 200 },
  { symbol: 'NVDA', name: 'NVIDIA', fcf: 40e9, growth5y: 0.25, growth10y: 0.15, shares: 24.5e9, debt: 10e9, price: 130 },
  { symbol: 'META', name: 'Meta', fcf: 50e9, growth5y: 0.10, growth10y: 0.06, shares: 2.5e9, debt: 30e9, price: 550 },
  { symbol: 'TSLA', name: 'Tesla', fcf: 10e9, growth5y: 0.20, growth10y: 0.12, shares: 3.2e9, debt: 5e9, price: 250 },
  { symbol: 'BBCA.JK', name: 'BCA', fcf: 35e9, growth5y: 0.10, growth10y: 0.07, shares: 12.4e9, debt: 0, price: 9500 },
]

// AI signals watchlist (ai-signals page)
export const AI_SIGNALS_WATCHLIST = [
  { symbol: 'AAPL', name: 'Apple', class: 'equity' },
  { symbol: 'MSFT', name: 'Microsoft', class: 'equity' },
  { symbol: 'NVDA', name: 'NVIDIA', class: 'equity' },
  { symbol: 'TSLA', name: 'Tesla', class: 'equity' },
  { symbol: 'BTC-USD', name: 'Bitcoin', class: 'crypto' },
  { symbol: 'ETH-USD', name: 'Ethereum', class: 'crypto' },
  { symbol: 'GC=F', name: 'Gold', class: 'commodity' },
  { symbol: 'CL=F', name: 'Crude Oil', class: 'commodity' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', class: 'forex' },
  { symbol: 'JPY=X', name: 'USD/JPY', class: 'forex' },
] as const

// Commodity futures groups (commodities page + /api/v1/commodities)
export const COMMODITY_GROUPS: Array<{ category: string; items: CommodityItem[] }> = [
  {
    category: 'Precious Metals',
    items: [
      { symbol: 'GC=F', name: 'Gold', unit: '$/oz' },
      { symbol: 'SI=F', name: 'Silver', unit: '$/oz' },
      { symbol: 'PL=F', name: 'Platinum', unit: '$/oz' },
      { symbol: 'PA=F', name: 'Palladium', unit: '$/oz' },
    ],
  },
  {
    category: 'Energy',
    items: [
      { symbol: 'CL=F', name: 'WTI Crude Oil', unit: '$/bbl' },
      { symbol: 'BZ=F', name: 'Brent Crude', unit: '$/bbl' },
      { symbol: 'NG=F', name: 'Natural Gas', unit: '$/MMBtu' },
      { symbol: 'HO=F', name: 'Heating Oil', unit: '$/gal' },
      { symbol: 'RB=F', name: 'RBOB Gasoline', unit: '$/gal' },
    ],
  },
  {
    category: 'Industrial Metals',
    items: [{ symbol: 'HG=F', name: 'Copper', unit: '$/lb' }],
  },
  {
    category: 'Agriculture',
    items: [
      { symbol: 'ZC=F', name: 'Corn', unit: '$/bu' },
      { symbol: 'ZW=F', name: 'Wheat', unit: '$/bu' },
      { symbol: 'ZS=F', name: 'Soybeans', unit: '$/bu' },
      { symbol: 'KC=F', name: 'Coffee', unit: '$/lb' },
      { symbol: 'SB=F', name: 'Sugar', unit: '$/lb' },
      { symbol: 'CT=F', name: 'Cotton', unit: '$/lb' },
      { symbol: 'CC=F', name: 'Cocoa', unit: '$/mt' },
    ],
  },
  {
    category: 'Livestock',
    items: [
      { symbol: 'LE=F', name: 'Live Cattle', unit: '$/lb' },
      { symbol: 'HE=F', name: 'Lean Hogs', unit: '$/lb' },
    ],
  },
]

export const ALL_COMMODITIES: CommodityItem[] = COMMODITY_GROUPS.flatMap((g) => g.items)

// Symbol → friendly name (compare page)
export const COMMODITY_NAMES: Record<string, string> = Object.fromEntries(
  ALL_COMMODITIES.map((c) => [c.symbol, c.name]),
)

// Crypto UI tab filters (orderbook / trades / liquidations / market-score)
export const CRYPTO_TAB_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'ARB', 'OP'] as const
export const MARKET_SCORE_TOP_SYMBOLS = [...CRYPTO_TAB_SYMBOLS, 'ADA']

// Lead-lag pair scan watchlist (/api/v1/lead-lag)
export const LEAD_LAG_WATCHLIST = ['BTC', 'ETH', 'SOL', 'WIF', 'BONK'] as const

// Sectors.app Yahoo fallback quote set (sectors-app module)
export const SECTORS_APP_FALLBACK_SYMBOLS = ['^JKSE', ...IDX_FALLBACK.slice(0, 4).map((s) => s.symbol)]

// ─────────────────────────────────────────────────────────────
// Taxonomy translation: TradingView sector → IDX-IC style sector.
// Applied at serve time over the live universe (see idx-universe
// provider). Unmapped values pass through unchanged.
// ─────────────────────────────────────────────────────────────
export const TV_TO_IC_SECTOR: Record<string, string> = {
  Finance: 'Financials',
  Communications: 'Infrastructure',
  'Consumer Durables': 'Consumer Cyclicals',
  'Consumer Non-Durables': 'Consumer Non-Cyclicals',
  'Non-Energy Minerals': 'Basic Materials',
  'Energy Minerals': 'Energy',
  'Technology Services': 'Technology',
  'Health Technology': 'Healthcare',
  'Health Services': 'Healthcare',
  'Industrial Services': 'Industrials',
  'Process Industries': 'Basic Materials',
  Transportation: 'Infrastructure',
  Utilities: 'Utilities',
  'Retail Trade': 'Consumer Cyclicals',
  'Distribution Services': 'Consumer Cyclicals',
  'Commercial Services': 'Technology',
  'Consumer Services': 'Consumer Cyclicals',
  'Miscellaneous': 'Others',
}
