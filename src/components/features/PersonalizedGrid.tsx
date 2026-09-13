"use client"

import { useState, useEffect, useCallback } from "react"
import { ResponsiveGridLayout } from "react-grid-layout"

const STORAGE_KEY = "dashboard-layout"

export interface PanelDef {
  id: string
  title: string
  minW?: number
  minH?: number
  defaultW: number
  defaultH: number
  content: React.ReactNode
}

interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

function PanelWrapper({ panel }: { panel: PanelDef }) {
  return (
    <div className="h-full overflow-hidden rounded border border-bg-border bg-bg-panel flex flex-col">
      <div className="flex items-center justify-between px-2 py-1 border-b border-bg-border bg-bg-raised/50 shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-wide text-text-muted truncate">
          {panel.title}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{panel.content}</div>
    </div>
  )
}

export function PersonalizedGrid({ panels }: { panels: PanelDef[] }) {
  const [layouts, setLayouts] = useState<Record<string, LayoutItem[]> | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // One-shot hydration from localStorage. Reading storage during render
    // would break SSR; setState happens in a microtask so it is not
    // synchronous-in-effect (react-hooks cascading-render rule).
    let alive = true
    Promise.resolve().then(() => {
      if (!alive) return
      setMounted(true)
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) setLayouts(JSON.parse(saved))
      } catch { /* ignore */ }
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (mounted && layouts) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts)) } catch { /* ignore */ }
    }
  }, [layouts, mounted])

  const onLayoutChange = useCallback((layout: LayoutItem[]) => {
    setLayouts({ lg: layout })
  }, [])

  const resetLayout = useCallback(() => {
    setLayouts(null)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  const defaultLg: LayoutItem[] = panels.map((p, i) => ({
    i: p.id,
    x: (i * p.defaultW) % 12,
    y: Math.floor((i * p.defaultW) / 12) * p.defaultH,
    w: p.defaultW,
    h: p.defaultH,
    minW: p.minW ?? 2,
    minH: p.minH ?? 2,
  }))

  const activeLayouts = (layouts ?? { lg: defaultLg }) as unknown as Parameters<typeof ResponsiveGridLayout>[0]["layouts"]

  return (
    <div className="relative">
      <div className="flex justify-end mb-1">
        <button onClick={resetLayout}
          className="px-2 py-0.5 text-[10px] font-mono rounded border border-bg-border text-text-muted hover:text-text-primary">
          Reset layout
        </button>
      </div>
      <ResponsiveGridLayout
        className="layout"
        width={1200}
        layouts={activeLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={60}
        onLayoutChange={onLayoutChange as (...args: unknown[]) => void}
        margin={[6, 6]}
      >
        {panels.map((panel) => (
          <div key={panel.id} className="h-full">
            <PanelWrapper panel={panel} />
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  )
}
