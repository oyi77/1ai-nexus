"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

interface ExplainProps {
  text: string
  className?: string
}

export function Explain({ text, className = "" }: ExplainProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Esc
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (
        popRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      )
        return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // Position the popover above the trigger (fixed to viewport, not clipped by
  // DataTable's overflow-auto wrapper or Panel's overflow-hidden).
  function toggle() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = 288 // max-w-xs = 20rem
    const top = r.top - 8
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPos({ top, left })
    setOpen((v) => !v)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="What does this mean?"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-bg-border text-[10px] font-mono text-text-muted transition-colors hover:border-teal-vivid hover:text-teal-vivid ${className}`}
      >
        ?
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="tooltip"
            style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateY(-100%)" }}
            className="z-[1000] max-w-xs -translate-x-0 rounded-lg border border-bg-border bg-bg-raised p-3 text-xs leading-relaxed text-text-secondary shadow-lg"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}
