// ─────────────────────────────────────────────────────────────
// CSRF Token Manager
// Generates a random token on page load, includes in all API requests
// ─────────────────────────────────────────────────────────────

const CSRF_HEADER = 'x-csrf-token'

// Generate a random token (stored in sessionStorage)
function getOrCreateToken(): string {
  if (typeof window === 'undefined') return ''
  
  let token = sessionStorage.getItem('nexus-csrf')
  if (!token) {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    token = Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
    sessionStorage.setItem('nexus-csrf', token)
  }
  return token
}

// Get the current CSRF token
export function getCsrfToken(): string {
  return getOrCreateToken()
}

// Enhanced fetch that includes CSRF token
export async function csrfFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getCsrfToken()
  
  const headers = new Headers(options.headers)
  if (token) {
    headers.set(CSRF_HEADER, token)
  }
  
  return fetch(url, { ...options, headers })
}

// Auto-patch global fetch (optional, for legacy code)
export function enableCsrfProtection(): void {
  if (typeof window === 'undefined') return
  
  const originalFetch = window.fetch
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    
    // Only add CSRF to our API calls
    if (url.startsWith('/api/') || url.includes('tracker.aitradepulse.com/api/')) {
      const token = getCsrfToken()
      const headers = new Headers(init?.headers)
      if (token && !headers.has(CSRF_HEADER)) {
        headers.set(CSRF_HEADER, token)
      }
      return originalFetch.call(this, input, { ...init, headers })
    }
    
    return originalFetch.call(this, input, init)
  }
}
