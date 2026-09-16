import {
  LayoutDashboard, Coins, Building2, Zap, Bell,
  Globe, TrendingUp, BarChart3, Activity, Shield, Radio, Eye, Flame,
  Target, DollarSign, Package, Cloud, GitCompare, PieChart, Users,
  Newspaper, Gauge, Code,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  description?: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}
interface NavSection {
  title: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, description: 'Live market overview and your saved panels.' },
      { label: 'AI Signals', href: '/ai-signals', icon: Zap, description: 'AI-generated trade ideas and signal feed.' },
      { label: 'AI Insights', href: '/ai-insights', icon: Zap, description: 'AI summaries of market conditions.' },
      { label: 'Alpha Feed', href: '/alpha', icon: Zap, description: 'Curated high-conviction opportunities.' },
      { label: 'Watchlist', href: '/watchlist', icon: Eye, description: 'Assets you track closely.' },
      { label: 'Alerts', href: '/alerts', icon: Bell, description: 'Price and on-chain alerts you set.' },
      { label: 'Following', href: '/following', icon: Users, description: 'Track traders, entities and wallets you follow.' },
      { label: 'Intelligence Score', href: '/intelligence-score', icon: Gauge, description: 'A/B/C intelligence grade per asset.' },
      { label: 'Market Intelligence', href: '/intelligence', icon: Activity, description: 'Cross-asset conviction signals — every symbol scored BUY/WAIT/SELL.' },
      { label: 'Insights', href: '/insights', icon: TrendingUp, description: 'Daily conviction signals — top BUY/SELL with track record.' },
      { label: 'Fear & Greed', href: '/fear-greed', icon: Gauge, description: 'Crowd sentiment index with the components behind it.' },
      { label: 'Conviction Board', href: '/intelligence/leaderboard', icon: Target, description: 'Proof that conviction scores predict price moves.' },
    ],
  },
  {
    title: 'Markets',
    items: [
      { label: 'Equities', href: '/equities', icon: Building2, description: 'Stocks and equity market data.' },

      { label: 'Commodities', href: '/commodities', icon: Package, description: 'Gold, oil and commodity prices.' },
      { label: 'Bonds', href: '/bonds', icon: TrendingUp, description: 'Government and corporate bond yields.' },
      { label: 'Derivatives', href: '/derivatives', icon: TrendingUp, description: 'Futures, perps and derivative markets.' },
      { label: 'Deriv Intel', href: '/derivatives-intel', icon: TrendingUp, description: 'Intelligence on derivative flows.' },
      { label: 'ETF Flows', href: '/etf-flows', icon: TrendingUp, description: 'Fund inflows and outflows for ETFs.' },
      { label: 'Market Overview', href: '/market', icon: BarChart3, description: 'Cross-asset overview: crypto, equity, FX and commodities.' },
      { label: 'Trending', href: '/trending', icon: Flame, description: 'What the market is searching for right now.' },
      { label: 'Order Book', href: '/orderbook', icon: BarChart3, description: 'Live bid/ask depth and walls for top perps.' },
    ],
  },
  {
    title: 'On-Chain',
    items: [
      { label: 'On-Chain Hub', href: '/onchain', icon: Radio, description: 'All on-chain analytics in one place.' },
      { label: 'Top Traders', href: '/top-traders', icon: TrendingUp, description: 'Leading wallets and smart-money traders.' },
      { label: 'On-Chain Intel', href: '/onchain-intel', icon: Radio, description: 'Signals derived from blockchain activity.' },
      { label: 'Token Explorer', href: '/token-god-mode', icon: Target, description: 'Deep dive into any token metrics.' },
      { label: 'Risk Intel', href: '/risk-intel', icon: Shield, description: 'Portfolio and market risk indicators.' },
      { label: 'Dev Activity', href: '/dev-activity', icon: Code, description: 'Developer and GitHub repository activity.' },
      { label: 'Attention Index', href: '/attention-index', icon: Eye, description: 'How much attention each asset is getting.' },
      { label: 'Stablecoin Intel', href: '/stablecoin-intel', icon: DollarSign, description: 'Stablecoin supply and flow signals.' },
      { label: 'Infra Signals', href: '/infra-signals', icon: Radio, description: 'Blockchain infrastructure health metrics.' },
      { label: 'Cycle Indicators', href: '/cycle-indicators', icon: Activity, description: 'Market-cycle timing indicators.' },
      { label: 'Entity Intel', href: '/entities', icon: Users, description: 'Wallet and entity profiling — label, cluster, PnL.' },
      { label: 'Whale Clusters', href: '/whale-cluster', icon: Eye, description: 'Connected wallets controlled by the same entity.' },
      { label: 'Knowledge Graph', href: '/graph', icon: GitCompare, description: 'Interactive graph of entity relationships.' },
      { label: 'DEX Monitor', href: '/dex', icon: Radio, description: 'Live swap radar — large trades, price impact, MEV.' },
      { label: 'RugCheck', href: '/rugcheck', icon: Shield, description: 'Honeypot and rug-pull detector for any token.' },
      { label: 'Smart Money', href: '/smart-money', icon: Users, description: 'Cohort-level smart-money positioning and cohorts.' },
      { label: 'Mempool Radar', href: '/mempool', icon: Radio, description: 'Pending-transaction radar for large moves.' },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'Charts', href: '/charts', icon: BarChart3, description: 'Price charts and technical views.' },
      { label: 'Backtest', href: '/backtest', icon: Activity, description: 'Test a strategy against history.' },
      { label: 'Options Chain', href: '/options', icon: TrendingUp, description: 'Options contracts and pricing.' },
      { label: 'Basis Scanner', href: '/basis', icon: Activity, description: 'Spot vs futures basis spreads.' },
      { label: 'Liquidations', href: '/liquidations', icon: Activity, description: 'Forced liquidation events.' },
      { label: 'Arbitrage', href: '/arbitrage', icon: Activity, description: 'Cross-exchange price gaps.' },
      { label: 'MEV Detector', href: '/mev', icon: Shield, description: 'Maximal-extractable-value activity.' },
      { label: 'Composite Signals', href: '/composite-alerts', icon: Activity, description: 'Blended multi-factor signal score.' },
      { label: 'Options Intel', href: '/options-intel', icon: Activity, description: 'Options flow and sentiment.' },
      { label: 'Market Score', href: '/market-score', icon: Gauge, description: 'Composite market-moving score from 10+ sources.' },
      { label: 'Degen Scanner', href: '/scanner', icon: Flame, description: 'Real-time monitoring of newly created pairs.' },
      { label: 'Token Compare', href: '/compare/tokens', icon: GitCompare, description: 'Conviction scores side by side across tokens.' },
      { label: 'Gap Board', href: '/gaps', icon: Activity, description: 'Cross-venue gaps and price dislocations.' },
    ],
  },
  {
    title: 'Macro & News',
    items: [
      { label: 'Macro Hub', href: '/macro-hub', icon: Globe, description: 'Global macro indicators.' },
      { label: 'Global Macro', href: '/global-macro', icon: Globe, description: 'World economic data.' },
      { label: 'Indonesia', href: '/indonesia-macro', icon: Globe, description: 'Indonesia-focused market data.' },
      { label: 'News Feed', href: '/news-feed', icon: Newspaper, description: 'Latest crypto and macro news.' },
      { label: 'News Intel', href: '/news-intel', icon: Newspaper, description: 'News-driven market signals.' },
      { label: 'Correlations', href: '/correlations', icon: GitCompare, description: 'How assets move together.' },
      { label: 'Corr Matrix', href: '/correlation-matrix', icon: GitCompare, description: 'Correlation matrix across assets.' },
      { label: 'Macro Command', href: '/macro', icon: Globe, description: 'Global macro indicators, yield curves and sentiment.' },
      { label: 'Econ Calendar', href: '/calendar', icon: Newspaper, description: 'Upcoming macro events from Fed, ECB and BOJ.' },
      { label: 'Forex', href: '/forex', icon: DollarSign, description: 'Live FX rates across major pairs.' },
      { label: 'Feeds', href: '/feeds', icon: Radio, description: 'Aggregated market news and data feeds.' },
    ],
  },
  {
    title: 'DeFi',
    items: [
      { label: 'DeFi Hub', href: '/defi-hub', icon: Coins, description: 'Decentralized finance analytics.' },
      { label: 'Stablecoins', href: '/stablecoins', icon: Coins, description: 'Stablecoin market overview.' },
      { label: 'Sectors', href: '/sectors', icon: PieChart, description: 'Market sector performance.' },
      { label: 'Token Unlocks', href: '/unlocks', icon: PieChart, description: 'Upcoming token unlock schedules.' },
      { label: 'Yield Farming', href: '/yields', icon: Coins, description: 'Top yield opportunities from DeFiLlama pools.' },
      { label: 'Yield Finder', href: '/defi/yields', icon: Coins, description: 'Filterable DeFi yield finder with risk labels.' },
      { label: 'TVL Dashboard', href: '/defi/tvl', icon: PieChart, description: 'DeFi protocol TVL ranked and filterable.' },
      { label: 'Protocol Revenue', href: '/revenue', icon: DollarSign, description: 'Fees, revenue and P/E ratios for protocols.' },
    ],
  },
  {
    title: 'Copy Trading',
    items: [
      { label: 'Leaderboard', href: '/copy-trading', icon: Users, description: 'Top copy-trading leaders.' },
      { label: 'Performance', href: '/copy-trading/performance', icon: Users, description: 'Copy-trading performance view.' },
    ],
  },
  {
    title: 'Meme',
    items: [
      { label: 'Meme Alpha', href: '/meme', icon: Flame, description: 'Meme-token discovery & risk audit.' },
      { label: 'Leaderboard', href: '/meme/leaderboard', icon: Flame, description: 'Ranked meme-token discovery feed.' },
      { label: 'Risk Audit', href: '/meme/risk', icon: Shield, description: 'Honeypot / rug-pull risk audit.' },
      { label: 'Launch Alpha', href: '/meme/launch-alpha', icon: Flame, description: 'Recently launched meme tokens.' },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { label: 'Analytics Hub', href: '/analytics', icon: Zap, description: 'All analytics tools.' },
      { label: 'Watchlist Ideas', href: '/saham-ideas', icon: Flame, description: 'Value + accumulation screen for IDX stocks.' },
      { label: 'IDX Saham Hub', href: '/saham', icon: Flame, description: 'Unified IDX terminal — ideas, signals, bandarmology with instrument filter.' },
      { label: 'Moonshot Board', href: '/moonshot', icon: Target, description: 'Cross-instrument runners, confidence-gated top 10.' },
      { label: 'Financials', href: '/financials', icon: Building2, description: 'Financial statements and ratios.' },
      { label: '20Y History', href: '/historical-financials', icon: Building2, description: 'Twenty years of price history.' },
      { label: 'DCF Model', href: '/dcf', icon: TrendingUp, description: 'Discounted-cash-flow valuation.' },
      { label: 'Comps', href: '/comps', icon: GitCompare, description: 'Comparable company analysis.' },
      { label: 'ETF', href: '/etf', icon: PieChart, description: 'Exchange-traded fund data.' },
      { label: 'Heatmap', href: '/heatmap', icon: PieChart, description: 'Market heatmap by movers.' },
      { label: 'Compare', href: '/compare', icon: GitCompare, description: 'Compare assets side by side.' },
      { label: 'Insider', href: '/insider', icon: Users, description: 'Insider trading activity.' },
      { label: 'Weather', href: '/weather', icon: Cloud, description: 'Market sentiment weather gauge.' },
      { label: 'Fundamentals', href: '/fundamentals', icon: Building2, description: 'Company fundamentals across US, IDX, EU and Asia.' },
      { label: 'Token Intel', href: '/tokens', icon: Coins, description: 'Per-token deep dive — price, liquidity, holders, signals.' },
      { label: 'Token Discovery', href: '/tokens/discover', icon: Target, description: 'Screened new and trending token candidates.' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Portfolio Risk', href: '/portfolio', icon: BarChart3, description: 'Your portfolio risk breakdown.' },
      { label: 'PnL Tracker', href: '/pnl', icon: BarChart3, description: 'Profit and loss tracking.' },
      { label: 'Exchange Flow', href: '/exchange-flow', icon: BarChart3, description: 'Exchange deposit/withdrawal flows.' },
      { label: 'Gas Tracker', href: '/gas', icon: Activity, description: 'Network gas fees.' },
      { label: 'API Docs', href: '/api-docs', icon: BarChart3, description: 'Developer API reference.' },
      { label: 'Status', href: '/status', icon: Shield, description: 'System and data status.' },
      { label: 'Live Trades', href: '/trades', icon: Activity, description: 'Real-time trade feed.' },
      { label: 'Widget', href: '/widget', icon: Code, description: 'Drop-in NEXUS Intelligence embed.' },
    ],
  },
  {
    title: 'Forecasts',
    items: [
      { label: 'Prediction Markets', href: '/prediction-markets', icon: Target, description: 'Polymarket and Kalshi odds side by side.' },
      { label: 'Markets Hub', href: '/predictions', icon: Target, description: 'All prediction-market views in one place.' },
      { label: 'Paper Trading', href: '/predictions/paper', icon: Activity, description: 'Paper-trade the forecast book.' },
      { label: 'Trade Tape', href: '/predictions/tape', icon: Activity, description: 'Live execution tape for forecasts.' },
      { label: 'Forecast Board', href: '/predictions/leaderboard', icon: TrendingUp, description: 'Ranked forecasters and their accuracy.' },
    ],
  },
]
