"use client"

import { useEffect } from 'react'
import { enableCsrfProtection } from '@/lib/csrf'

// Patch window.fetch at module scope — runs before any child useEffect,
// so API calls made on mount always carry the CSRF token.
enableCsrfProtection()

export function CsrfProvider({ children }: { children: React.ReactNode }) {
  // Defensive: re-apply in case of HMR or module re-evaluation
  useEffect(() => { enableCsrfProtection() }, [])
  return <>{children}</>
}
