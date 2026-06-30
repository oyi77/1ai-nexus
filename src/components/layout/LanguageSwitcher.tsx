"use client"

import { useState, useEffect } from 'react'
import { setLocale, getLocale, getLocaleName, type Locale } from '@/lib/i18n'
import { Globe } from 'lucide-react'

const LOCALES: Locale[] = ['en', 'id']

export function LanguageSwitcher() {
  const [locale, setCurrentLocale] = useState<Locale>('en')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setCurrentLocale(getLocale())
  }, [])

  const handleSelect = (l: Locale) => {
    setLocale(l)
    setCurrentLocale(l)
    setOpen(false)
    // Force re-render of page by reloading
    window.location.reload()
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors"
        title="Language / Bahasa"
      >
        <Globe size={12} />
        <span>{locale.toUpperCase()}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-bg-panel border border-border-dim rounded-lg shadow-lg z-50 min-w-32">
          {LOCALES.map(l => (
            <button
              key={l}
              onClick={() => handleSelect(l)}
              className={`w-full text-left px-3 py-2 text-xs font-mono hover:bg-bg-elevated transition-colors ${
                l === locale ? 'text-accent-cyan font-bold' : 'text-text-dim'
              }`}
            >
              {getLocaleName(l)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
