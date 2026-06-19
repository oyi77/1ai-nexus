"use client"

import { TickerStrip } from "../layout/TickerStrip"
import { LiveFeedPanel } from "../layout/LiveFeedPanel"
import { AiAssistantPanel } from "@/components/terminal/AiAssistantPanel"
import { useState, useEffect } from "react"

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-bg-deep text-text-primary overflow-hidden">
      {/* Nav Bar — 32px */}
      <nav className="flex items-center justify-between px-3 py-1 border-b border-border-dim bg-bg-panel" style={{ height: 32 }}>
        <div className="flex items-center gap-3">
          <span className="text-accent-green font-bold font-mono text-xs">▦ NEXUS</span>
          <div className="flex gap-0.5">
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
          <a href="/settings/modules" className="text-text-dim hover:text-text-primary">⚙</a>
          <span className="text-text-muted">⌘K</span>
          <span className="text-text-dim">{time}</span>
        </div>
      </nav>

      {/* Ticker Strip — 28px */}
      <TickerStrip />

      {/* Context Bar — 24px */}
      <ContextBar />

      {/* Main Content — 3-column */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Live Feed — 280px */}
        <aside className="w-70 border-r border-border-dim bg-bg-panel flex flex-col shrink-0">
          <LiveFeedPanel />
        </aside>

        {/* Center: Main Panel */}
        <main className="flex-1 overflow-auto bg-bg-deep">
          {children}
        </main>

        {/* Right: AI Assistant — 280px */}
        <aside className="w-70 border-l border-border-dim bg-bg-panel flex flex-col shrink-0">
          <AiAssistantPanel />
        </aside>
      </div>
    </div>
  )
}

function ContextBar() {
  return (
    <div className="flex items-center gap-4 px-3 py-0.5 bg-bg-panel border-b border-border-dim text-[10px] font-mono" style={{ height: 24 }}>
      <span className="text-text-dim">MODULES: <span className="text-accent-cyan">45</span></span>
      <span className="text-text-dim">SOURCES: <span className="text-accent-cyan">100+</span></span>
      <span className="text-text-dim">ENTITIES: <span className="text-accent-cyan">153</span></span>
      <span className="text-text-dim">FEEDS: <span className="text-accent-cyan">60+</span></span>
      <span className="ml-auto text-text-muted">1-8: panels · /: search · ⌘K: commands</span>
    </div>
  )
}
