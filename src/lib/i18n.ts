// ─── Indonesian Language Support (i18n) ───────────────────
// Simple translation system for Bahasa Indonesia.
// Use `t(key)` in components to get translated text.
// Falls back to key if translation not found.
// ─────────────────────────────────────────────────────────

export type Locale = 'en' | 'id'

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Navigation
    'nav.overview': 'Overview',
    'nav.markets': 'Markets',
    'nav.onchain': 'On-Chain',
    'nav.trading': 'Trading',
    'nav.macro': 'Macro & News',
    'nav.defi': 'DeFi',
    'nav.analytics': 'Analytics',
    'nav.tools': 'Tools',

    // Common
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.price': 'Price',
    'common.change': 'Change',
    'common.volume': 'Volume',
    'common.marketCap': 'Market Cap',
    'common.high': 'High',
    'common.low': 'Low',
    'common.open': 'Open',
    'common.close': 'Close',
    'common.search': 'Search...',
    'common.filter': 'Filter',
    'common.sort': 'Sort',
    'common.refresh': 'Refresh',
    'common.live': 'LIVE',
    'common.stale': 'STALE',
    'common.offline': 'OFFLINE',

    // Dashboard
    'dashboard.title': 'Command Center',
    'dashboard.subtitle': 'Markets, macro, and intelligence at a glance',

    // Markets
    'markets.equities': 'Equities',
    'markets.forex': 'Forex',
    'markets.commodities': 'Commodities',
    'markets.derivatives': 'Derivatives',
    'markets.indices': 'Indices',

    // Macro
    'macro.title': 'Macro Command Center',
    'macro.subtitle': 'Global macro indicators, yield curves, and sentiment',
    'macro.indonesia': 'Indonesia Macro Dashboard',
    'macro.indonesia.subtitle': 'Bank Indonesia, BPS, World Bank indicators',

    // Screener
    'screener.title': 'Multi-Asset Screener',
    'screener.sector': 'Sector',
    'screener.exchange': 'Exchange',
    'screener.pe': 'P/E',
    'screener.dividend': 'Dividend',
    'screener.results': 'results',

    // Fundamentals
    'fundamentals.title': 'Company Fundamentals',
    'fundamentals.valuation': 'Valuation',
    'fundamentals.profitability': 'Profitability',
    'fundamentals.health': 'Financial Health',

    // Portfolio
    'portfolio.title': 'Portfolio Risk Analytics',
    'portfolio.totalValue': 'Total Value',
    'portfolio.var': 'Daily VaR',
    'portfolio.sharpe': 'Sharpe Ratio',
    'portfolio.beta': 'Portfolio Beta',

    // Alerts
    'alerts.title': 'Alerts',
    'alerts.create': 'Create Alert',
    'alerts.triggered': 'Triggered',

    // On-Chain
    'onchain.whale': 'Whale Alerts',
    'onchain.smart': 'Smart Money',
    'onchain.mev': 'MEV Detection',
    'onchain.scanner': 'Token Scanner',
  },
  id: {
    // Navigation
    'nav.overview': 'Ringkasan',
    'nav.markets': 'Pasar',
    'nav.onchain': 'On-Chain',
    'nav.trading': 'Trading',
    'nav.macro': 'Makro & Berita',
    'nav.defi': 'DeFi',
    'nav.analytics': 'Analitik',
    'nav.tools': 'Alat',

    // Common
    'common.loading': 'Memuat...',
    'common.error': 'Kesalahan',
    'common.price': 'Harga',
    'common.change': 'Perubahan',
    'common.volume': 'Volume',
    'common.marketCap': 'Kapitalisasi Pasar',
    'common.high': 'Tertinggi',
    'common.low': 'Terendah',
    'common.open': 'Buka',
    'common.close': 'Tutup',
    'common.search': 'Cari...',
    'common.filter': 'Filter',
    'common.sort': 'Urutkan',
    'common.refresh': 'Segarkan',
    'common.live': 'LANGSUNG',
    'common.stale': 'KADALUARSA',
    'common.offline': 'LUAR JARINGAN',

    // Dashboard
    'dashboard.title': 'Pusat Komando',
    'dashboard.subtitle': 'Pasar, makro, dan intelijen dalam sekali pandang',

    // Markets
    'markets.equities': 'Saham',
    'markets.forex': 'Valas',
    'markets.commodities': 'Komoditas',
    'markets.derivatives': 'Derivatif',
    'markets.indices': 'Indeks',

    // Macro
    'macro.title': 'Pusat Komando Makro',
    'macro.subtitle': 'Indikator makro global, kurva imbal hasil, dan sentimen',
    'macro.indonesia': 'Dasbor Makro Indonesia',
    'macro.indonesia.subtitle': 'Indikator Bank Indonesia, BPS, Bank Dunia',

    // Screener
    'screener.title': 'Screener Multi-Aset',
    'screener.sector': 'Sektor',
    'screener.exchange': 'Bursa',
    'screener.pe': 'P/E',
    'screener.dividend': 'Dividen',
    'screener.results': 'hasil',

    // Fundamentals
    'fundamentals.title': 'Fundamental Perusahaan',
    'fundamentals.valuation': 'Valuasi',
    'fundamentals.profitability': 'Profitabilitas',
    'fundamentals.health': 'Kesehatan Keuangan',

    // Portfolio
    'portfolio.title': 'Analitik Risiko Portofolio',
    'portfolio.totalValue': 'Total Nilai',
    'portfolio.var': 'VaR Harian',
    'portfolio.sharpe': 'Rasio Sharpe',
    'portfolio.beta': 'Beta Portofolio',

    // Alerts
    'alerts.title': 'Peringatan',
    'alerts.create': 'Buat Peringatan',
    'alerts.triggered': 'Tercetus',

    // On-Chain
    'onchain.whale': 'Peringatan Paus',
    'onchain.smart': 'Uang Pintar',
    'onchain.mev': 'Deteksi MEV',
    'onchain.scanner': 'Pemindai Token',
  },
}

let currentLocale: Locale = 'en'

export function setLocale(locale: Locale): void {
  currentLocale = locale
  if (typeof window !== 'undefined') {
    localStorage.setItem('nexus-locale', locale)
  }
}

export function getLocale(): Locale {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('nexus-locale') as Locale
    if (stored && (stored === 'en' || stored === 'id')) {
      currentLocale = stored
    }
  }
  return currentLocale
}

export function t(key: string): string {
  const locale = getLocale()
  return translations[locale]?.[key] ?? translations['en']?.[key] ?? key
}

export function getLocaleName(locale: Locale): string {
  const names: Record<Locale, string> = {
    en: 'English',
    id: 'Bahasa Indonesia',
  }
  return names[locale] ?? locale
}
