"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Coins, Building2, Zap, Bell,
  ChevronLeft, ChevronRight, Search, Globe,
  TrendingUp, BarChart3, Activity, Shield, Radio, Eye,
} from 'lucide-react'
import { LiveDot } from '../primitives/LiveDot'
import { CommandBar } from './CommandBar'

const NAV_ITEMS = [
  { label: '⚡ Alpha Feed',  href: '/alpha',          icon: Zap },
  { label: 'Dashboard',    href: '/dashboard',      icon: LayoutDashboard },
  { label: 'Tokens',       href: '/tokens',        icon: Coins },
  { label: 'Entities',     href: '/entities',       icon: Building2 },
  { label: 'Smart Money',  href: '/smart-money',    icon: Zap },
  { label: 'Derivatives',  href: '/derivatives',    icon: TrendingUp },
  { label: 'Gaps',         href: '/gaps',           icon: Activity },
  { label: 'DEX Monitor',  href: '/dex',            icon: Activity },
  { label: 'Alerts',       href: '/alerts',         icon: Bell },
  { label: 'News',         href: '/news',           icon: Globe },
  { label: 'Macro',        href: '/macro',          icon: Globe },
  { label: 'PnL Tracker',  href: '/pnl',            icon: BarChart3 },
  { label: 'Status',       href: '/status',         icon: Shield },
]

interface NexusLayoutProps {
  children: React.ReactNode
}

export function NexusLayout({ children }: NexusLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [time, setTime] = useState('')
  const [tickers, setTickers] = useState<Array<{ symbol: string; price: string; change: string; positive: boolean }>>([])
  const [fgi, setFgi] = useState<number | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)

    const fetchTickers = () => {
      fetch('/api/v1/market/prices').then(r => r.json()).then(d => { if (d.tickers) setTickers(d.tickers) }).catch(() => {})
      fetch('/api/v1/fear-greed').then(r => r.json()).then(d => { if (d.data?.composite?.score) setFgi(d.data.composite.score) }).catch(() => {})
    }
    fetchTickers()
    const tickerId = setInterval(fetchTickers, 30_000)

    return () => { clearInterval(id); clearInterval(tickerId) }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-bg-base text-text-primary overflow-hidden">
      {/* ── TopBar (48px) ── */}
      <header className="flex items-center justify-between px-3 border-b border-bg-border bg-bg-panel shrink-0" style={{ height: 48 }}>
        {/* Left: Logo + Search */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-teal-vivid font-bold text-[15px] font-mono tracking-tight">NEXUS</span>
            <span className="text-[9px] text-text-muted font-mono hidden sm:inline">v2.0</span>
          </Link>
          <CommandBar />
        </div>

        {/* Center: Global Ticker — Live Data */}
        <div className="hidden lg:flex items-center gap-4 text-[11px] font-mono">
          {tickers.slice(0, 4).map((t, i) => (
            <span key={i} className="text-text-muted">{t.symbol} <span className={t.positive ? 'text-data-bull' : 'text-data-bear'}>{t.price}</span></span>
          ))}
          {fgi !== null && <span className="text-text-muted">FGI <span className="text-data-warn">{fgi}</span></span>}
        </div>

        {/* Right: Status + Actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <LiveDot status="live" size={5} />
            <span className="text-text-muted hidden sm:inline">LIVE</span>
          </div>
          <span className="text-[11px] font-mono text-text-secondary tabular-nums">{time}</span>
          <button className="p-1.5 rounded hover:bg-bg-raised transition-colors">
            <Bell size={14} className="text-text-muted" />
          </button>
        </div>
      </header>

      {/* ── Main Area ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── SideNav (220px / 48px collapsed) ── */}
        <nav
          className="flex flex-col border-r border-bg-border bg-bg-panel shrink-0 overflow-y-auto scrollbar-thin transition-all duration-200"
          style={{ width: collapsed ? 48 : 200 }}
        >
          {/* Nav Items */}
          <div className="flex-1 py-1">
            {NAV_ITEMS.map(item => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
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

          {/* Collapse Toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center py-2 border-t border-bg-border hover:bg-bg-raised transition-colors"
          >
            {collapsed ? <ChevronRight size={14} className="text-text-muted" /> : <ChevronLeft size={14} className="text-text-muted" />}
          </button>
        </nav>

        {/* ── MainContent ── */}
        <main className="flex-1 overflow-auto scrollbar-thin bg-bg-base">
          {children}
        </main>
      </div>
    </div>
  )
}
