import {
  LayoutDashboard, Coins, Building2, Zap, Bell,
  Globe, TrendingUp, BarChart3, Activity, Shield, Radio, Eye, Flame,
  Target, DollarSign, Package, Cloud, GitCompare, PieChart, Users,
  Newspaper, Gauge, Code, Wallet, LineChart, Server,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  description?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  category?: string    // Visual sub-category header (e.g. 'TradFi & Equities')
  isPrimary?: boolean  // Included in 'Simple' (Essential) mode
  badge?: string       // Optional pill tag (e.g. 'HOT', 'NEW', 'PRO', 'ID')
}

export interface NavSection {
  title: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  href: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    items: [
      { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, description: 'Live market overview and your saved panels.', isPrimary: true },
      { label: 'Watchlist', href: '/watchlist', icon: Eye, description: 'Assets you track closely.', isPrimary: true },
      { label: 'Alerts', href: '/alerts', icon: Bell, description: 'Price and on-chain alerts you set.' },
      { label: 'Account', href: '/account', icon: Users, description: 'Profile, plan and payment history.' },
      { label: 'Following', href: '/following', icon: Users, description: 'Track traders, entities and wallets you follow.' },
      { label: 'Portfolio Risk', href: '/portfolio', icon: BarChart3, description: 'Your portfolio risk breakdown.', isPrimary: true },
      { label: 'PnL Tracker', href: '/pnl', icon: BarChart3, description: 'Profit and loss tracking.' },
      { label: 'Status', href: '/status', icon: Server, description: 'System, cron and data-source health.' },
      { label: 'API Docs', href: '/api-docs', icon: Code, description: 'Developer API reference.' },
      { label: 'Widget', href: '/widget', icon: Code, description: 'Drop-in NEXUS Intelligence embed.' },
    ],
  },
  {
    title: 'Signals',
    icon: Zap,
    href: '/signals',
    items: [
      { label: 'All Signals', href: '/signals', icon: Zap, description: 'Every signal lane in one page — conviction, alpha, IDX.', isPrimary: true },
      { label: 'AI Signals', href: '/signals?tab=alpha', icon: Flame, description: 'High-conviction flow and curated opportunities from the alpha lane.', isPrimary: true, badge: 'AI' },
      { label: 'Market Intelligence', href: '/signals?tab=conviction', icon: Activity, description: 'Cross-asset conviction signals — every symbol scored BUY/WAIT/SELL.' },
      { label: 'Conviction Board', href: '/intelligence/leaderboard', icon: Target, description: 'Proof that conviction scores predict price moves.' },
      { label: 'Intelligence Score', href: '/intelligence-score', icon: Gauge, description: 'A/B/C intelligence grade per asset.' },
      { label: 'Composite Signals', href: '/composite-alerts', icon: Activity, description: 'Blended multi-factor signal score.' },
      { label: 'Market Score', href: '/market-score', icon: Gauge, description: 'Composite market-moving score from 10+ sources.' },
      { label: 'Fear & Greed', href: '/fear-greed', icon: Gauge, description: 'Crowd sentiment index with the components behind it.', isPrimary: true },
    ],
  },
  {
    title: 'Markets',
    icon: LineChart,
    href: '/markets',
    items: [
      // Core & Screeners
      { label: 'Markets Hub', href: '/markets', icon: Globe, description: 'Every instrument at a glance — live previews with deep links.', category: 'Core & Screeners' },
      { label: 'Screener', href: '/screener', icon: BarChart3, description: 'Filterable screener across every supported market.', category: 'Core & Screeners', isPrimary: true },
      { label: 'Market Overview', href: '/market', icon: BarChart3, description: 'Cross-asset overview: crypto, equity, FX and commodities.', category: 'Core & Screeners' },
      { label: 'Trending', href: '/trending', icon: Flame, description: 'What the market is searching for right now.', category: 'Core & Screeners', isPrimary: true, badge: 'HOT' },
      { label: 'Moonshot Board', href: '/moonshot', icon: Target, description: 'Cross-instrument runners, confidence-gated top 10.', category: 'Core & Screeners' },

      // Indonesian & Equities
      { label: 'IDX Saham', href: '/saham', icon: LineChart, description: 'IDX terminal — ideas, signals, bandarmology and market breadth in one tabbed hub.', category: 'Indonesian & Equities', isPrimary: true, badge: 'ID' },
      { label: 'Equities', href: '/equities', icon: Building2, description: 'Stocks and equity market data.', category: 'Indonesian & Equities' },
      { label: 'Fundamentals', href: '/fundamentals', icon: Building2, description: 'Company fundamentals across US, IDX, EU and Asia.', category: 'Indonesian & Equities' },
      { label: 'Financials', href: '/financials', icon: Building2, description: 'Financial statements and ratios.', category: 'Indonesian & Equities' },
      { label: 'DCF Model', href: '/dcf', icon: LineChart, description: 'Discounted-cash-flow valuation.', category: 'Indonesian & Equities' },
      { label: 'Comps', href: '/comps', icon: GitCompare, description: 'Comparable company analysis.', category: 'Indonesian & Equities' },
      { label: 'Insider', href: '/insider', icon: Users, description: 'Insider trading activity.', category: 'Indonesian & Equities' },
      { label: '20Y History', href: '/historical-financials', icon: Building2, description: 'Twenty years of price history.', category: 'Indonesian & Equities' },

      // Crypto & Tokens
      { label: 'Token Intel', href: '/tokens', icon: Coins, description: 'Per-token deep dive — price, liquidity, holders, signals.', category: 'Crypto & Tokens' },
      { label: 'Token Discovery', href: '/tokens/discover', icon: Target, description: 'Screened new and trending token candidates.', category: 'Crypto & Tokens' },
      { label: 'Compare', href: '/compare', icon: GitCompare, description: 'Compare assets side by side.', category: 'Crypto & Tokens' },
      { label: 'Token Compare', href: '/compare/tokens', icon: GitCompare, description: 'Conviction scores side by side across tokens.', category: 'Crypto & Tokens' },
      { label: 'Charts', href: '/charts', icon: BarChart3, description: 'Price charts and technical views.', category: 'Crypto & Tokens' },
      { label: 'Order Book', href: '/orderbook', icon: BarChart3, description: 'Live bid/ask depth and walls for top perps.', category: 'Crypto & Tokens' },
      { label: 'Heatmap', href: '/heatmap', icon: PieChart, description: 'Market heatmap by movers.', category: 'Crypto & Tokens' },

      // TradFi & Derivatives
      { label: 'Commodities', href: '/commodities', icon: Package, description: 'Gold, oil and commodity prices.', category: 'TradFi & Derivatives' },
      { label: 'Forex', href: '/forex', icon: DollarSign, description: 'Live FX rates across major pairs.', category: 'TradFi & Derivatives' },
      { label: 'Bonds', href: '/bonds', icon: TrendingUp, description: 'Government and corporate bond yields.', category: 'TradFi & Derivatives' },
      { label: 'Derivatives', href: '/derivatives', icon: TrendingUp, description: 'Futures, perps and derivative markets.', category: 'TradFi & Derivatives' },
      { label: 'Deriv Intel', href: '/derivatives-intel', icon: TrendingUp, description: 'Intelligence on derivative flows.', category: 'TradFi & Derivatives' },
      { label: 'Options Chain', href: '/options', icon: TrendingUp, description: 'Options contracts and pricing.', category: 'TradFi & Derivatives' },
      { label: 'Options Intel', href: '/options-intel', icon: Activity, description: 'Options flow and sentiment.', category: 'TradFi & Derivatives' },
      { label: 'ETF', href: '/etf', icon: PieChart, description: 'Exchange-traded fund data.', category: 'TradFi & Derivatives' },
      { label: 'ETF Flows', href: '/etf-flows', icon: TrendingUp, description: 'Fund inflows and outflows for ETFs.', category: 'TradFi & Derivatives' },
    ],
  },
  {
    title: 'On-Chain',
    icon: Wallet,
    href: '/onchain',
    items: [
      // Whales & Smart Money
      { label: 'On-Chain Hub', href: '/onchain', icon: Radio, description: 'All on-chain analytics in one place.', category: 'Whales & Smart Money' },
      { label: 'Smart Money', href: '/smart-money', icon: Users, description: 'Cohort-level smart-money positioning and cohorts.', category: 'Whales & Smart Money', isPrimary: true, badge: 'PRO' },
      { label: 'Whale Clusters', href: '/whale-cluster', icon: Eye, description: 'Connected wallets controlled by the same entity.', category: 'Whales & Smart Money', isPrimary: true },
      { label: 'Top Traders', href: '/top-traders', icon: TrendingUp, description: 'Leading wallets and smart-money traders.', category: 'Whales & Smart Money' },
      { label: 'Copy Trading', href: '/copy-trading', icon: Users, description: 'Top copy-trading leaders and performance.', category: 'Whales & Smart Money', isPrimary: true },
      { label: 'Copy Performance', href: '/copy-trading/performance', icon: Users, description: 'Copy-trading performance breakdown.', category: 'Whales & Smart Money' },
      { label: 'Entity Intel', href: '/entities', icon: Users, description: 'Wallet and entity profiling — label, cluster, PnL.', category: 'Whales & Smart Money' },
      { label: 'Knowledge Graph', href: '/graph', icon: GitCompare, description: 'Interactive graph of entity relationships.', category: 'Whales & Smart Money' },

      // DEX Radar & Scanners
      { label: 'DEX Monitor', href: '/dex', icon: Radio, description: 'Live swap radar — large trades, price impact, MEV.', category: 'DEX Radar & Scanners' },
      { label: 'Degen Scanner', href: '/scanner', icon: Flame, description: 'Real-time monitoring of newly created pairs.', category: 'DEX Radar & Scanners' },
      { label: 'Mempool Radar', href: '/mempool', icon: Radio, description: 'Pending-transaction radar for large moves.', category: 'DEX Radar & Scanners' },
      { label: 'Live Trades', href: '/trades', icon: Activity, description: 'Real-time trade feed.', category: 'DEX Radar & Scanners' },
      { label: 'MEV Detector', href: '/mev', icon: Shield, description: 'Maximal-extractable-value activity.', category: 'DEX Radar & Scanners' },
      { label: 'Gas Tracker', href: '/gas', icon: Activity, description: 'Network gas fees.', category: 'DEX Radar & Scanners' },
      { label: 'Token Explorer', href: '/token-god-mode', icon: Target, description: 'Deep dive into any token metrics.', category: 'DEX Radar & Scanners' },

      // DeFi & Yields
      { label: 'DeFi Hub', href: '/defi-hub', icon: Coins, description: 'Decentralized finance analytics.', category: 'DeFi & Yields' },
      { label: 'Yield Farming', href: '/yields', icon: Coins, description: 'Top yield opportunities from DeFiLlama pools.', category: 'DeFi & Yields' },
      { label: 'Yield Finder', href: '/defi/yields', icon: Coins, description: 'Filterable DeFi yield finder with risk labels.', category: 'DeFi & Yields' },
      { label: 'TVL Dashboard', href: '/defi/tvl', icon: PieChart, description: 'DeFi protocol TVL ranked and filterable.', category: 'DeFi & Yields' },
      { label: 'Protocol Revenue', href: '/revenue', icon: DollarSign, description: 'Fees, revenue and P/E ratios for protocols.', category: 'DeFi & Yields' },
      { label: 'Stablecoins', href: '/stablecoins', icon: Coins, description: 'Stablecoin market overview.', category: 'DeFi & Yields' },
      { label: 'Stablecoin Intel', href: '/stablecoin-intel', icon: DollarSign, description: 'Stablecoin supply and flow signals.', category: 'DeFi & Yields' },
      { label: 'Token Unlocks', href: '/unlocks', icon: PieChart, description: 'Upcoming token unlock schedules.', category: 'DeFi & Yields' },

      // Ecosystem & Macro
      { label: 'On-Chain Intel', href: '/onchain-intel', icon: Radio, description: 'Signals derived from blockchain activity.', category: 'Ecosystem & Macro' },
      { label: 'Exchange Flow', href: '/exchange-flow', icon: BarChart3, description: 'Exchange deposit/withdrawal flows.', category: 'Ecosystem & Macro' },
      { label: 'Sectors', href: '/sectors', icon: PieChart, description: 'Market sector performance.', category: 'Ecosystem & Macro' },
      { label: 'Risk Intel', href: '/risk-intel', icon: Shield, description: 'Portfolio and market risk indicators.', category: 'Ecosystem & Macro' },
      { label: 'Dev Activity', href: '/dev-activity', icon: Code, description: 'Developer and GitHub repository activity.', category: 'Ecosystem & Macro' },
      { label: 'Attention Index', href: '/attention-index', icon: Eye, description: 'How much attention each asset is getting.', category: 'Ecosystem & Macro' },
      { label: 'Infra Signals', href: '/infra-signals', icon: Radio, description: 'Blockchain infrastructure health metrics.', category: 'Ecosystem & Macro' },
    ],
  },
  {
    title: 'Meme',
    icon: Flame,
    href: '/meme',
    items: [
      { label: 'Meme Hub', href: '/meme', icon: Flame, description: 'Meme-token discovery and risk audit.' },
      { label: 'Sniper', href: '/meme/sniper', icon: Target, description: 'Screened meme candidates with rejection reasons and signal tiers (screening only — execution lives in 1ai-trade-dex).', isPrimary: true, badge: 'HOT' },
      { label: 'Risk Audit', href: '/meme/risk', icon: Shield, description: 'Honeypot / rug-pull risk audit.', isPrimary: true },
      { label: 'Meme Leaderboard', href: '/meme/leaderboard', icon: Flame, description: 'Ranked meme-token discovery feed.' },
      { label: 'Launch Alpha', href: '/meme/launch-alpha', icon: Flame, description: 'Recently launched meme tokens.' },
      { label: 'Moby Screener', href: '/meme/moby', icon: Target, description: 'Moby smart-money groups, launchpads, charts and PnL.' },
    ],
  },
  {
    title: 'Macro',
    icon: Globe,
    href: '/macro-hub',
    items: [
      { label: 'Macro Hub', href: '/macro-hub', icon: Globe, description: 'Global macro indicators.' },
      { label: 'Macro Command', href: '/macro', icon: Globe, description: 'Global macro indicators, yield curves and sentiment.' },
      { label: 'Global Macro', href: '/global-macro', icon: Globe, description: 'World economic data.' },
      { label: 'Indonesia', href: '/indonesia-macro', icon: Globe, description: 'Indonesia-focused market data.' },
      { label: 'News Feed', href: '/news-feed', icon: Newspaper, description: 'Latest crypto and macro news.' },
      { label: 'News Intel', href: '/news-intel', icon: Newspaper, description: 'News-driven market signals.' },
      { label: 'Feeds', href: '/feeds', icon: Radio, description: 'Aggregated market news and data feeds.' },
      { label: 'Correlations', href: '/correlations', icon: GitCompare, description: 'How assets move together.' },
      { label: 'Corr Matrix', href: '/correlation-matrix', icon: GitCompare, description: 'Correlation matrix across assets.' },
      { label: 'Econ Calendar', href: '/calendar', icon: Newspaper, description: 'Upcoming macro events from Fed, ECB and BOJ.' },
      { label: 'Cycle Indicators', href: '/cycle-indicators', icon: Activity, description: 'Market-cycle timing indicators.' },
      { label: 'Weather', href: '/weather', icon: Cloud, description: 'Market sentiment weather gauge.' },
    ],
  },
  {
    title: 'Forecasts',
    icon: Target,
    href: '/predictions',
    items: [
      { label: 'Forecast Hub', href: '/predictions', icon: Target, description: 'Prediction-market, paper, tape and board lanes in one tabbed surface.' },
      { label: 'Forecast Markets', href: '/predictions?tab=markets', icon: Target, description: 'Polymarket, Manifold, Metaculus and Alphio odds side by side.' },
      { label: 'Paper Trading', href: '/predictions?tab=paper', icon: Activity, description: 'Paper-trade the forecast book.' },
      { label: 'Trade Tape', href: '/predictions?tab=tape', icon: Activity, description: 'Live execution tape for forecasts.' },
      { label: 'Forecast Board', href: '/predictions?tab=board', icon: TrendingUp, description: 'Ranked forecast markets by volume and traders.' },
      { label: 'Backtest', href: '/backtest', icon: Activity, description: 'Test a strategy against recorded signal history.' },
      { label: 'Alpha Engine', href: '/alpha-engine', icon: Zap, description: 'Engine-level alpha scoring and paper-trading outcomes.' },
    ],
  },
  {
    title: 'Research',
    icon: Activity,
    href: '/analytics',
    items: [
      { label: 'Analytics Hub', href: '/analytics', icon: Zap, description: 'All analytics tools.' },
      { label: 'Basis Scanner', href: '/basis', icon: Activity, description: 'Spot vs futures basis spreads.' },
      { label: 'Liquidations', href: '/liquidations', icon: Activity, description: 'Forced liquidation events.' },
      { label: 'Arbitrage', href: '/arbitrage', icon: Activity, description: 'Cross-exchange price gaps.' },
      { label: 'Gap Board', href: '/gaps', icon: Activity, description: 'Cross-venue gaps and price dislocations.' },
      { label: 'Capital Flows', href: '/flows', icon: BarChart3, description: 'Cross-asset capital flow tracking.' },
    ],
  },
]

export const NAV_TOP_LEVEL = NAV_SECTIONS.map((s) => ({ label: s.title, href: s.href, icon: s.icon }))
