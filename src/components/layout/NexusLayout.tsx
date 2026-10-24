"use client"

import { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Menu, X, ChevronLeft, ChevronRight, ChevronDown,
  LayoutDashboard, BarChart3, Activity, Users, User,
} from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/config/nav'
import { getActiveNavHref } from '@/lib/config/nav-matcher'
import { LiveDot } from '../primitives/LiveDot'
import { CommandBar } from './CommandBar'
import { NotificationTray } from './NotificationTray'
import { TickerStrip } from './TickerStrip'
import { PwaInstallPrompt } from './PwaInstallPrompt'
import { GlobalSearch } from './GlobalSearch'

interface NexusLayoutProps {
  children: React.ReactNode
}

// ── Mobile bottom-nav — top-5 destinations (visible < lg) ──
const MOBILE_NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Markets', href: '/screener', icon: BarChart3 },
  { label: 'Intelligence', href: '/intelligence', icon: Activity },
  { label: 'Following', href: '/following', icon: Users },
  { label: 'Account', href: '/account', icon: User },
]

interface SidebarNavProps {
  collapsed: boolean
  setCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void
  setMobileMenuOpen: (v: boolean) => void
}

function SidebarNav({ collapsed, setCollapsed, setMobileMenuOpen }: SidebarNavProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [navMode, setNavMode] = useState<'simple' | 'pro'>('simple')
  const [openSection, setOpenSection] = useState<string | null>(null)

  // Hydrate user preference from localStorage safely in microtask
  useEffect(() => {
    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      try {
        const saved = localStorage.getItem('nexus_nav_mode')
        if (saved === 'simple' || saved === 'pro') {
          setNavMode(saved)
        }
      } catch {}
    })
    return () => { alive = false }
  }, [])

  const handleModeChange = (mode: 'simple' | 'pro') => {
    setNavMode(mode)
    try {
      localStorage.setItem('nexus_nav_mode', mode)
    } catch {}
  }

  // Precompute all registered hrefs for precision matching
  const allHrefs = useMemo(() => {
    return NAV_SECTIONS.flatMap(s => s.items.map(i => i.href))
  }, [])

  // Resolve single active item href via specificity engine
  const activeHref = useMemo(() => {
    return getActiveNavHref(allHrefs, pathname, searchParams)
  }, [allHrefs, pathname, searchParams])


  return (
    <>
      {/* ── Mode Switcher (Simple vs Pro) — desktop & expanded only ── */}
      {!collapsed && (
        <div className="px-3 pt-2.5 pb-2 border-b border-bg-border/60 shrink-0">
          <div className="flex items-center h-7 p-0.5 rounded-md bg-bg-base/80 border border-bg-border/60 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => handleModeChange('simple')}
              className={`flex-1 h-full rounded flex items-center justify-center transition-colors ${
                navMode === 'simple'
                  ? 'bg-bg-raised text-teal-vivid font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('pro')}
              className={`flex-1 h-full rounded flex items-center justify-center transition-colors ${
                navMode === 'pro'
                  ? 'bg-bg-raised text-teal-vivid font-semibold shadow-xs'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Pro
            </button>
          </div>
        </div>
      )}

      {/* ── Nav Sections ── */}
      <div className="flex-1 py-1 overflow-y-auto scrollbar-thin">
        {NAV_SECTIONS.map(section => {
          // In simple mode, show only primary items unless the active item is in this section
          const visibleItems = navMode === 'simple'
            ? section.items.filter(item => item.isPrimary || item.href === activeHref)
            : section.items

          // If no items visible in this section (in simple mode) and section is not active, hide section
          const isSectionActive = section.items.some(i => i.href === activeHref) ||
            (activeHref === null && (pathname === section.href || pathname.startsWith(`${section.href}/`)))

          if (visibleItems.length === 0 && !isSectionActive) {
            return null
          }

          const isOpen = openSection === section.title || (openSection === null && isSectionActive)
          const SectionIcon = section.icon

          return (
            <div key={section.title} className="border-b border-bg-border/60 last:border-b-0">
              {collapsed ? (
                <Link
                  href={section.href}
                  onClick={() => setMobileMenuOpen(false)}
                  title={section.title}
                  className={`flex items-center justify-center h-9 mx-1 my-0.5 rounded-md transition-colors ${
                    isSectionActive
                      ? 'bg-teal-dim/40 text-teal-vivid'
                      : 'text-text-muted hover:bg-bg-raised hover:text-text-secondary'
                  }`}
                >
                  <SectionIcon size={15} />
                </Link>
              ) : (
                <>
                  <div className={`flex items-center gap-1 pl-3 pr-2 ${isSectionActive ? 'text-text-primary' : 'text-text-muted'}`}>
                    <Link
                      href={section.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex flex-1 items-center gap-2 min-w-0 py-2 text-[12px] font-semibold uppercase tracking-wider hover:text-text-secondary transition-colors"
                    >
                      <SectionIcon size={13} className="shrink-0" />
                      <span className="truncate">{section.title}</span>
                      <span className="font-mono text-[10px] text-text-muted/70 normal-case tracking-normal">
                        {visibleItems.length}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => setOpenSection(isOpen && openSection === section.title ? null : section.title)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${section.title}`}
                      className="flex h-11 w-8 items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
                    >
                      <ChevronDown size={12} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="pb-1.5">
                      {visibleItems.map((item, idx) => {
                        const isActive = item.href === activeHref
                        const Icon = item.icon

                        // In Pro mode, render sub-category header if category changed
                        const showCategoryHeader = navMode === 'pro' &&
                          Boolean(item.category) &&
                          (idx === 0 || visibleItems[idx - 1]?.category !== item.category)

                        return (
                          <div key={`${item.href}::${item.label}`}>
                            {showCategoryHeader && (
                              <div className="pt-2 pb-1 px-3 flex items-center gap-1.5">
                                <span className="text-[10px] uppercase font-mono tracking-wider text-text-muted/60 select-none">
                                  {item.category}
                                </span>
                                <div className="h-px flex-1 bg-bg-border/40" />
                              </div>
                            )}
                            <Link
                              href={item.href}
                              onClick={() => setMobileMenuOpen(false)}
                              className={`flex items-center gap-2.5 mx-2 rounded-md pl-2.5 pr-2 py-1.5 text-[13px] transition-colors border-l-2 ${
                                isActive
                                  ? 'border-teal-vivid bg-teal-dim/30 text-teal-vivid font-semibold'
                                  : 'border-transparent text-text-secondary hover:bg-bg-raised hover:text-text-primary'
                              }`}
                              title={item.description ? item.description : item.label}
                            >
                              <Icon size={14} className="shrink-0" />
                              <span className="truncate">{item.label}</span>
                              {item.badge && (
                                <span
                                  className={`ml-auto text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                                    item.badge === 'HOT'
                                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                      : item.badge === 'ID'
                                        ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                                        : item.badge === 'PRO'
                                          ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                          : 'bg-teal-dim/30 text-teal-vivid border border-teal-vivid/30'
                                  }`}
                                >
                                  {item.badge}
                                </span>
                              )}
                            </Link>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Collapse Toggle — desktop only */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex items-center justify-center py-2 border-t border-bg-border hover:bg-bg-raised transition-colors shrink-0"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRight size={14} className="text-text-muted" />
        ) : (
          <ChevronLeft size={14} className="text-text-muted" />
        )}
      </button>
    </>
  )
}

function SidebarNavFallback({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex-1 py-3 px-2 text-center text-text-muted text-xs font-mono">
      {collapsed ? '...' : 'Loading navigation...'}
    </div>
  )
}

export function NexusLayout({ children }: NexusLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
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

    const fetchTickers = () => {}
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
            flex flex-col border-r border-bg-border bg-bg-panel shrink-0 transition-all duration-200 z-50
            lg:relative lg:translate-x-0
            fixed inset-y-0 left-0 top-12
            ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
          style={{ width: collapsed ? 52 : 216 }}
        >
          <Suspense fallback={<SidebarNavFallback collapsed={collapsed} />}>
            <SidebarNav
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              setMobileMenuOpen={setMobileMenuOpen}
            />
          </Suspense>
        </nav>

        {/* ── MainContent ── */}
        <main className="flex-1 overflow-auto scrollbar-thin bg-bg-base has-mobile-bottom-nav">
          {children}
        </main>
      </div>
      <GlobalSearch />
      <PwaInstallPrompt />

      {/* ── Mobile Bottom Nav (visible < lg) ── */}
      <nav
        aria-label="Mobile navigation"
        className="mobile-bottom-nav lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-bg-border bg-bg-panel/95 backdrop-blur-md"
      >
        <div className="flex items-stretch h-16">
          {MOBILE_NAV.map(item => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`))
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors
                  ${isActive ? 'text-teal-vivid' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <Icon size={20} strokeWidth={isActive ? 2.25 : 2} className="shrink-0" />
                <span className="leading-none">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
