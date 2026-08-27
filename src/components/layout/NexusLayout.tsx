"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Coins, Building2, Zap, Bell,
  ChevronLeft, ChevronRight, ChevronDown, Globe,
  TrendingUp, BarChart3, Activity, Shield, Radio, Eye,
  Menu, X, Target, DollarSign, Package, Calendar,
  Cloud, GitCompare, PieChart, Users, ArrowUpDown,
  Newspaper, Gauge, Code,
} from 'lucide-react'
import { LiveDot } from '../primitives/LiveDot'
import { CommandBar } from './CommandBar'
import { NotificationTray } from './NotificationTray'
import { TickerStrip } from './TickerStrip'
import { PwaInstallPrompt } from './PwaInstallPrompt'
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
const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, description: 'Live market overview and your saved panels.' },
      { label: 'AI Signals', href: '/ai-signals', icon: Zap, description: 'AI-generated trade ideas and signal feed.' },
      { label: 'AI Insights', href: '/ai-insights', icon: Zap, description: 'AI summaries of market conditions.' },
      { label: 'Alpha Feed', href: '/alpha', icon: Zap, description: 'Curated high-conviction opportunities.' },
      { label: 'Watchlist', href: '/watchlist', icon: Eye, description: 'Assets you track closely.' },
      { label: 'Alerts', href: '/alerts', icon: Bell, description: 'Price and on-chain alerts you set.' },
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

interface NexusLayoutProps {
  children: React.ReactNode
}

export function NexusLayout({ children }: NexusLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [time, setTime] = useState('')
  
  
  const pathname = usePathname()

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)

    const fetchTickers = () => {

    }
    fetchTickers()
    const tickerId = setInterval(fetchTickers, 30_000)

    return () => { clearInterval(id); clearInterval(tickerId) }
  }, [])

  // Close mobile menu on navigation
  useEffect(() => {
    const close = () => setMobileMenuOpen(false)
    close()
  }, [pathname])

  return (
    <div className="h-screen flex flex-col bg-bg-base text-text-primary overflow-hidden">
      {/* ── TopBar (48px) ── */}
      <TickerStrip />
      <header className="flex items-center justify-between px-3 border-b border-bg-border bg-bg-panel shrink-0" style={{ height: 48 }}>
        {/* Left: Mobile menu + Logo + Search */}
        <div className="flex items-center gap-3">
          <button
            className="lg:hidden p-1.5 rounded hover:bg-bg-raised transition-colors text-text-muted"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link href="/" className="flex items-center gap-2">
            <span className="text-teal-vivid font-bold text-base tracking-tight">◆ NEXUS</span>
            <span className="text-xs text-text-muted hidden sm:inline">v2</span>
          </Link>
          <div className="hidden md:block">
            <CommandBar />
          </div>
        </div>

        {/* Spacer for layout balance */}
        <div className="flex-1" />

        {/* Right: Status + Actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <LiveDot status="live" size={5} />
            <span className="text-text-muted hidden sm:inline">LIVE</span>
          </div>
          <span className="text-xs font-mono text-text-secondary tabular-nums">{time}</span>
          <NotificationTray />
        </div>
      </header>

      {/* ── Main Area ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ── Mobile Overlay ── */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            onClick={() => setMobileMenuOpen(false)}
          />

        )}

        {/* ── SideNav — Desktop: fixed sidebar, Mobile: slide-out drawer ── */}
        <nav
          role="navigation"
          aria-label="Main navigation"
          className={`
            flex flex-col border-r border-bg-border bg-bg-panel shrink-0 overflow-y-auto scrollbar-thin transition-all duration-200 z-50
            lg:relative lg:translate-x-0
            fixed inset-y-0 left-0 top-12
            ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
          style={{ width: collapsed ? 52 : 216 }}
        >
          {/* Nav Sections */}
          <div className="flex-1 py-1">
            {NAV_SECTIONS.map(section => {
              const sectionCollapsed = collapsedSections.has(section.title)
              const toggleSection = () => {
                setCollapsedSections(prev => {
                  const next = new Set(prev)
                  if (next.has(section.title)) next.delete(section.title)
                  else next.add(section.title)
                  return next
                })
              }
              return (
                <div key={section.title}>
                  {!collapsed && (
                    <button
                      onClick={toggleSection}
                      className="flex items-center justify-between w-full px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
                    >
                      <span>{section.title}</span>
                      <ChevronDown
                        size={12}
                        className={`transition-transform ${sectionCollapsed ? '-rotate-90' : ''}`}
                      />
                    </button>
                  )}
                  {(!sectionCollapsed || collapsed) && section.items.map(item => {
                    const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-2.5 mx-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors
                          ${isActive
                            ? 'bg-teal-dim/40 text-teal-vivid font-semibold'
                            : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary'
                          }`}
                        title={item.description ? item.description : item.label}
                      >
                        <Icon size={14} className="shrink-0" />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Collapse Toggle — desktop only */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex items-center justify-center py-2 border-t border-bg-border hover:bg-bg-raised transition-colors"
          >
            {collapsed ? <ChevronRight size={14} className="text-text-muted" /> : <ChevronLeft size={14} className="text-text-muted" />}
          </button>
        </nav>

        {/* ── MainContent ── */}
        <main className="flex-1 overflow-auto scrollbar-thin bg-bg-base">
          {children}
        </main>
      </div>
      <PwaInstallPrompt />
    </div>
  )
}
