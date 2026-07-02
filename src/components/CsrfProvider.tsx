"use client"

import { useEffect } from 'react'
import { enableCsrfProtection } from '@/lib/csrf'

// Enable CSRF protection on app load
export function CsrfProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    enableCsrfProtection()
  }, [])

  return <>{children}</>
}
