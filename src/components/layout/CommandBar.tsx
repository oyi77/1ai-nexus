"use client"

import { Search } from 'lucide-react'

export function CommandBar() {
  const handleOpen = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexus:open-search'))
    }
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-bg-border/80 bg-bg-base/70 hover:bg-bg-raised hover:border-teal-vivid/50 transition-all text-xs font-mono text-text-muted w-64 lg:w-80 group shadow-xs cursor-pointer text-left"
      aria-label="Open search and terminal commands"
      title="Search pages, assets, commands (⌘K or /)"
    >
      <Search size={13} className="text-text-muted group-hover:text-teal-vivid transition-colors shrink-0" />
      <span className="flex-1 truncate group-hover:text-text-primary transition-colors">
        Search or enter command…
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <kbd className="text-[10px] bg-bg-raised border border-bg-border px-1.5 py-0.5 rounded text-text-muted font-sans font-medium">
          ⌘K
        </kbd>
        <kbd className="text-[10px] bg-bg-raised border border-bg-border px-1.5 py-0.5 rounded text-text-muted font-mono">
          /
        </kbd>
      </div>
    </button>
  )
}
