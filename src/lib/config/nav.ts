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
    ],
  },
  {
    title: 'Markets',
    items: [
      { label: 'Equities', href: '/equities', icon: Building2, description: 'Stocks and equity market data.' },
      { label: 'Volume Profile', href: '/bandarmology', icon: BarChart3, description: 'Trading-volume and accumulation analysis.' },
      { label: 'Forex', href: '/forex', icon: DollarSign, description: 'Currency pair rates and moves.' },
      { label: 'Commodities', href: '/commodities', icon: Package, description: 'Gold, oil and commodity prices.' },
      { label: 'Bonds', href: '/bonds', icon: TrendingUp, description: 'Government and corporate bond yields.' },
      { label: 'Derivatives', href: '/derivatives', icon: TrendingUp, description: 'Futures, perps and derivative markets.' },
      { label: 'Deriv Intel', href: '/derivatives-intel', icon: TrendingUp, description: 'Intelligence on derivative flows.' },
      { label: 'ETF Flows', href: '/etf-flows', icon: TrendingUp, description: 'Fund inflows and outflows for ETFs.' },
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
      { label: 'Intel Score', href: '/intelligence-score', icon: Activity, description: 'A/B/C intelligence grade per asset.' },
      { label: 'Options Intel', href: '/options-intel', icon: Activity, description: 'Options flow and sentiment.' },
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
    ],
  },
  {
    title: 'DeFi',
    items: [
      { label: 'DeFi Hub', href: '/defi-hub', icon: Coins, description: 'Decentralized finance analytics.' },
      { label: 'Stablecoins', href: '/stablecoins', icon: Coins, description: 'Stablecoin market overview.' },
      { label: 'Sectors', href: '/sectors', icon: PieChart, description: 'Market sector performance.' },
      { label: 'Token Unlocks', href: '/unlocks', icon: PieChart, description: 'Upcoming token unlock schedules.' },
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
      { label: 'Screener', href: '/screener', icon: BarChart3, description: 'Filter assets by criteria.' },
      { label: 'Fundamentals', href: '/fundamentals', icon: Building2, description: 'Core company/token fundamentals.' },
      { label: 'Financials', href: '/financials', icon: Building2, description: 'Financial statements and ratios.' },
      { label: '20Y History', href: '/historical-financials', icon: Building2, description: 'Twenty years of price history.' },
      { label: 'DCF Model', href: '/dcf', icon: TrendingUp, description: 'Discounted-cash-flow valuation.' },
      { label: 'Comps', href: '/comps', icon: GitCompare, description: 'Comparable company analysis.' },
      { label: 'ETF', href: '/etf', icon: PieChart, description: 'Exchange-traded fund data.' },
      { label: 'Heatmap', href: '/heatmap', icon: PieChart, description: 'Market heatmap by movers.' },
      { label: 'Compare', href: '/compare', icon: GitCompare, description: 'Compare assets side by side.' },
      { label: 'Insider', href: '/insider', icon: Users, description: 'Insider trading activity.' },
      { label: 'Weather', href: '/weather', icon: Cloud, description: 'Market sentiment weather gauge.' },
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
    ],
  },
]
