"use client"

import { TickerStrip } from "../layout/TickerStrip"
import { LiveFeedPanel } from "../layout/LiveFeedPanel"
import { AiAssistantPanel } from "@/components/terminal/AiAssistantPanel"
import { useState, useEffect } from "react"
import { Menu, X, Bot } from "lucide-react"

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const [time, setTime] = useState('')
  const [showFeed, setShowFeed] = useState(false)
  const [showAi, setShowAi] = useState(false)

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 10_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-bg-deep text-text-primary overflow-hidden">
      {/* Nav Bar */}
      <nav className="flex items-center justify-between px-2 sm:px-3 py-1 border-b border-border-dim bg-bg-panel shrink-0" style={{ minHeight: 36 }}>
        <div className="flex items-center gap-2">
          {/* Mobile menu button */}
          <button
            onClick={() => setShowFeed(!showFeed)}
            className="sm:hidden p-1 text-text-dim hover:text-text-primary"
          >
            <Menu size={16} />
          </button>
          <span className="text-accent-green font-bold font-mono text-xs">▦ NEXUS</span>
          <div className="hidden sm:flex gap-0.5">
            {[
              { label: '1:TERMINAL', href: '/' },
              { label: '2:MARKET', href: '/market' },
              { label: '3:TOKENS', href: '/tokens' },
              { label: '4:DeFi', href: '/defi' },
              { label: '5:MACRO', href: '/macro' },
              { label: '6:NEWS', href: '/news' },
            ].map(tab => (
              <a
                key={tab.href}
                href={tab.href}
                className="px-2 py-0.5 text-[10px] text-text-dim hover:text-text-primary hover:bg-bg-elevated rounded transition-colors font-mono"
              >
                {tab.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="hidden sm:inline text-text-dim">{time}</span>
          <button
            onClick={() => setShowAi(!showAi)}
            className="sm:hidden p-1 text-text-dim hover:text-text-primary"
          >
            <Bot size={16} />
          </button>
          <a href="/settings/modules" className="hidden sm:block text-text-dim hover:text-text-primary">⚙</a>
        </div>
      </nav>

      {/* Ticker Strip — scrolls on mobile */}
      <TickerStrip />

      {/* Context Bar — hidden on very small screens */}
      <div className="hidden md:flex items-center gap-4 px-3 py-0.5 bg-bg-panel border-b border-border-dim text-[10px] font-mono shrink-0">
        <span className="text-text-dim">MODULES: <span className="text-accent-cyan">45</span></span>
        <span className="text-text-dim">SOURCES: <span className="text-accent-cyan">100+</span></span>
        <span className="text-text-dim">ENTITIES: <span className="text-accent-cyan">153</span></span>
        <span className="ml-auto text-text-muted">/: search · ⌘K: commands</span>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Live Feed — hidden on mobile, shown as overlay */}
        <aside className={`
          ${showFeed ? 'translate-x-0' : '-translate-x-full'}
          sm:translate-x-0
          absolute sm:relative z-20 sm:z-auto
          w-70 sm:w-70 h-full
          border-r border-border-dim bg-bg-panel flex flex-col shrink-0
          transition-transform sm:transition-none
        `}>
          <div className="sm:hidden flex items-center justify-between px-3 py-2 border-b border-border-dim">
            <span className="text-xs font-mono text-accent-cyan">LIVE FEED</span>
            <button onClick={() => setShowFeed(false)} className="text-text-dim"><X size={16} /></button>
          </div>
          <LiveFeedPanel />
        </aside>

        {/* Mobile overlay backdrop */}
        {(showFeed || showAi) && (
          <div
            className="sm:hidden absolute inset-0 bg-black/50 z-10"
            onClick={() => { setShowFeed(false); setShowAi(false) }}
          />
        )}

        {/* Center: Main Panel */}
        <main className="flex-1 overflow-auto bg-bg-deep">
          {children}
        </main>

        {/* Right: AI Assistant — hidden on mobile, shown as overlay */}
        <aside className={`
          ${showAi ? 'translate-x-0' : 'translate-x-full'}
          sm:translate-x-0
          absolute sm:relative right-0 z-20 sm:z-auto
          w-70 sm:w-70 h-full
          border-l border-border-dim bg-bg-panel flex flex-col shrink-0
          transition-transform sm:transition-none
        `}>
          <div className="sm:hidden flex items-center justify-between px-3 py-2 border-b border-border-dim">
            <span className="text-xs font-mono text-accent-cyan">NEXUS AI</span>
            <button onClick={() => setShowAi(false)} className="text-text-dim"><X size={16} /></button>
          </div>
          <AiAssistantPanel />
        </aside>
      </div>
    </div>
  )
}
