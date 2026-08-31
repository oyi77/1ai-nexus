"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/config/nav'
import { LiveDot } from '../primitives/LiveDot'
import { CommandBar } from './CommandBar'
import { NotificationTray } from './NotificationTray'
import { TickerStrip } from './TickerStrip'
import { PwaInstallPrompt } from './PwaInstallPrompt'
import { GlobalSearch } from './GlobalSearch'

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
      <GlobalSearch />
      <PwaInstallPrompt />
    </div>
  )
}
