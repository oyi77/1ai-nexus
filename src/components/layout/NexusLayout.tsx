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
  Newspaper,
} from 'lucide-react'
import { LiveDot } from '../primitives/LiveDot'
import { CommandBar } from './CommandBar'
import { NotificationTray } from './NotificationTray'
import { TickerStrip } from './TickerStrip'
import { PwaInstallPrompt } from './PwaInstallPrompt'
interface NavItem {
  label: string
  href: string
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
      { label: 'Dashboard',     href: '/dashboard',      icon: LayoutDashboard },
      { label: 'AI Insights',   href: '/ai-insights',    icon: Zap },
      { label: 'Alpha Feed',    href: '/alpha',          icon: Zap },
      { label: 'Watchlist',     href: '/watchlist',      icon: Eye },
      { label: 'Alerts',        href: '/alerts',         icon: Bell },
    ],
  },
  {
    title: 'Markets',
    items: [
      { label: 'Equities',      href: '/equities',       icon: Building2 },
      { label: 'Forex',         href: '/forex',          icon: DollarSign },
      { label: 'Commodities',   href: '/commodities',    icon: Package },
      { label: 'Bonds',         href: '/bonds',          icon: TrendingUp },
      { label: 'Derivatives',   href: '/derivatives',    icon: TrendingUp },
    ],
  },
  {
    title: 'On-Chain',
    items: [
      { label: 'On-Chain Hub',  href: '/onchain',        icon: Radio },
      { label: 'Token Scanner', href: '/scanner',        icon: Eye },
      { label: 'Token God Mode', href: '/token-god-mode', icon: Target },
      { label: 'Knowledge Graph', href: '/graph',        icon: Eye },
      { label: 'Top Traders',   href: '/top-traders',    icon: TrendingUp },
    ],
  },
  {
    title: 'Trading',
    items: [
      { label: 'Charts',        href: '/charts',         icon: BarChart3 },
      { label: 'Backtest',      href: '/backtest',       icon: Activity },
      { label: 'Order Book',    href: '/orderbook',      icon: BarChart3 },
      { label: 'Options',       href: '/options',        icon: TrendingUp },
      { label: 'Basis Scanner', href: '/basis',          icon: Activity },
      { label: 'Liquidations',  href: '/liquidations',   icon: Activity },
      { label: 'Arbitrage',     href: '/arbitrage',      icon: Activity },
      { label: 'MEV Detector',  href: '/mev',            icon: Shield },
    ],
  },
  {
    title: 'Macro & News',
    items: [
      { label: 'Macro Hub',     href: '/macro-hub',      icon: Globe },
      { label: 'Global Macro',  href: '/global-macro',   icon: Globe },
      { label: 'Indonesia',     href: '/indonesia-macro', icon: Globe },
      { label: 'Calendar',      href: '/calendar',       icon: Calendar },
      { label: 'Correlations',  href: '/correlations',   icon: GitCompare },
      { label: 'Corr Matrix',   href: '/correlation-matrix', icon: GitCompare },
      { label: 'News Feed',     href: '/news',           icon: Newspaper },
    ],
  },
  {
    title: 'DeFi',
    items: [
      { label: 'DeFi Hub',      href: '/defi-hub',       icon: Coins },
      { label: 'Stablecoins',   href: '/stablecoins',    icon: Coins },
      { label: 'Sectors',       href: '/sectors',        icon: PieChart },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { label: 'Analytics Hub', href: '/analytics',      icon: Zap },
      { label: 'Screener',      href: '/screener',       icon: BarChart3 },
      { label: 'Fundamentals',  href: '/fundamentals',   icon: Building2 },
      { label: 'Financials',    href: '/financials',     icon: Building2 },
      { label: 'DCF Model',     href: '/dcf',            icon: TrendingUp },
      { label: 'Comps',         href: '/comps',          icon: GitCompare },
      { label: 'ETF',           href: '/etf',            icon: PieChart },
      { label: 'Heatmap',       href: '/heatmap',        icon: PieChart },
      { label: 'Compare',       href: '/compare',        icon: GitCompare },
      { label: 'Insider',       href: '/insider',        icon: Users },
      { label: 'Weather',       href: '/weather',        icon: Cloud },
    ],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Portfolio Risk', href: '/portfolio',      icon: BarChart3 },
      { label: 'PnL Tracker',   href: '/pnl',            icon: BarChart3 },
      { label: 'Exchange Flow', href: '/exchange-flow',  icon: BarChart3 },
      { label: 'Gas Tracker',   href: '/gas',            icon: Activity },
      { label: 'Status',        href: '/status',         icon: Shield },
      { label: 'Live Trades',   href: '/trades',         icon: Activity },
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
            <span className="text-teal-vivid font-bold text-[15px] font-mono tracking-tight">NEXUS</span>
            <span className="text-[9px] text-text-muted font-mono hidden sm:inline">v2.0</span>
          </Link>
          <div className="hidden md:block">
            <CommandBar />
          </div>
        </div>

        {/* Spacer for layout balance */}
        <div className="flex-1" />

        {/* Right: Status + Actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <LiveDot status="live" size={5} />
            <span className="text-text-muted hidden sm:inline">LIVE</span>
          </div>
          <span className="text-[11px] font-mono text-text-secondary tabular-nums">{time}</span>
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
          style={{ width: collapsed ? 48 : 200 }}
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
                      className="flex items-center justify-between w-full px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
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
                        className={`flex items-center gap-2.5 px-3 py-1.5 text-[12px] font-medium transition-colors
                          ${isActive
                            ? 'bg-teal-dim/30 text-teal-vivid border-r-2 border-teal-vivid'
                            : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary'
                          }`}
                        title={collapsed ? item.label : undefined}
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
