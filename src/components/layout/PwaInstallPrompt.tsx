"use client"

import { useState, useEffect, useCallback } from 'react'
import { X, Download } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [isInstalled, setIsInstalled] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
  )

  useEffect(() => {
    // Skip event listener setup if already installed
    if (isInstalled) return

    // Check if dismissed recently
    const dismissed = localStorage.getItem('pwa-install-dismissed')
    if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 60 * 60 * 1000) {
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      // Show banner after 30 seconds of usage
      setTimeout(() => setShowBanner(true), 30_000)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [isInstalled])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setIsInstalled(true)
    }
    setDeferredPrompt(null)
    setShowBanner(false)
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setShowBanner(false)
    localStorage.setItem('pwa-install-dismissed', String(Date.now()))
  }, [])

  if (isInstalled || !showBanner || !deferredPrompt) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-50 animate-fade-in">
      <div className="bg-bg-panel border border-bg-border rounded-lg shadow-lg p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-teal-dim/20 flex items-center justify-center shrink-0">
              <Download size={18} className="text-teal-vivid" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary">Install NEXUS</p>
              <p className="text-[11px] text-text-muted mt-0.5">
                Add to home screen for quick access
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded hover:bg-bg-raised transition-colors text-text-muted shrink-0"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleDismiss}
            className="flex-1 px-3 py-1.5 text-[11px] font-medium text-text-muted bg-bg-raised rounded hover:bg-bg-border transition-colors"
          >
            Later
          </button>
          <button
            onClick={handleInstall}
            className="flex-1 px-3 py-1.5 text-[11px] font-medium text-bg-base bg-teal-vivid rounded hover:bg-teal-bright transition-colors"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  )
}
