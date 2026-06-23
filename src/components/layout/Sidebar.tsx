import Link from 'next/link'

import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Coins, Building2, Zap, TrendingUp, Activity, Radio,
  Bell, Eye, Globe, BarChart3, Shield, ChevronLeft, ChevronRight, Target,
} from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Dashboard',    href: '/dashboard',      icon: LayoutDashboard },
  { label: 'Tokens',       href: '/tokens',          icon: Coins },
  { label: 'Entities',     href: '/entities',         icon: Building2 },
  { label: 'Smart Money',  href: '/smart-money',      icon: Zap },
  { label: 'Derivatives',  href: '/derivatives',      icon: TrendingUp },
  { label: 'DEX Monitor',  href: '/dex',              icon: Activity },
  { label: 'Flows',        href: '/flows',            icon: Radio },
  { label: 'Alerts',       href: '/alerts',           icon: Bell },
  { label: 'OSINT',        href: '/compare',          icon: Eye },
  { label: 'Macro',        href: '/macro',            icon: Globe },
  { label: 'PnL Tracker',  href: '/pnl',              icon: BarChart3 },
  { label: 'Predictions', href: '/predictions',    icon: Target },
  { label: 'Status',       href: '/status',         icon: Shield },
]

interface SidebarProps {
  collapsed?: boolean
  onToggle?: () => void
}

export function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const pathname = usePathname()

  return (
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
      {onToggle && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center py-2 border-t border-bg-border hover:bg-bg-raised transition-colors"
        >
          {collapsed ? <ChevronRight size={14} className="text-text-muted" /> : <ChevronLeft size={14} className="text-text-muted" />}
        </button>
      )}
    </nav>
  )
}
