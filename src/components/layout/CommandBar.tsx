"use client"

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { parseCommand, getHistory, getAllCommands } from '@/lib/command/parser'
import { Search, ChevronRight, Clock, X } from 'lucide-react'

export function CommandBar() {
  const [input, setInput] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Global keyboard shortcut: / or Cmd+K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
      if (e.key === 'Escape') {
        setInput('')
        setIsOpen(false)
        setError(null)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Auto-suggest as user types
  useEffect(() => {
    if (!input.trim()) {
      setSuggestions([])
      return
    }
    const commands = getAllCommands()
    const matches = commands
      .filter(c => c.verb.startsWith(input.toUpperCase()) || c.description.toLowerCase().includes(input.toLowerCase()))
      .map(c => `${c.verb} — ${c.description}`)
      .slice(0, 5)
    setSuggestions(matches)
  }, [input])

  const execute = useCallback(() => {
    if (!input.trim()) return
    const result = parseCommand(input)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.route) {
      router.push(result.route)
      setInput('')
      setIsOpen(false)
      setError(null)
    }
  }, [input, router])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      execute()
      return
    }
    // Arrow up/down for history
    const hist = getHistory()
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIdx = Math.min(historyIdx + 1, hist.length - 1)
      setHistoryIdx(newIdx)
      if (hist[newIdx]) setInput(hist[newIdx])
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIdx = Math.max(historyIdx - 1, -1)
      setHistoryIdx(newIdx)
      setInput(newIdx >= 0 ? hist[newIdx] : '')
    }
  }, [execute, historyIdx])

  return (
    <div className="relative flex-1 max-w-md">
      <div className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors ${isOpen ? 'border-teal-vivid bg-bg-raised' : 'border-bg-border bg-bg-raised'}`}>
        <Search size={12} className="text-text-muted shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setError(null) }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder="BTC GP 1Y · KIMCHI · NEWS ID · /help"
          className="bg-transparent text-[11px] font-mono text-text-primary placeholder:text-text-muted outline-none w-full"
        />
        {input && (
          <button onClick={() => { setInput(''); setError(null) }} className="text-text-muted hover:text-text-secondary">
            <X size={10} />
          </button>
        )}
        <kbd className="text-[8px] text-text-muted bg-bg-base px-1 rounded shrink-0">⌘K</kbd>
      </div>

      {/* Suggestions dropdown */}
      {isOpen && (suggestions.length > 0 || error) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-panel border border-bg-border rounded shadow-lg z-50">
          {error && <div className="px-3 py-1.5 text-[10px] text-data-bear font-mono">{error}</div>}
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-text-secondary hover:bg-bg-raised hover:text-text-primary transition-colors flex items-center gap-2"
              onMouseDown={() => { setInput(s.split(' — ')[0]); execute() }}
            >
              <ChevronRight size={10} className="text-teal-vivid" />
              {s}
            </button>
          ))}
          {getHistory().length > 0 && (
            <div className="border-t border-bg-border px-3 py-1 text-[9px] text-text-muted font-mono flex items-center gap-1">
              <Clock size={8} /> ↑↓ for history · Enter to execute
            </div>
          )}
        </div>
      )}
    </div>
  )
}
