"use client"

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'

interface LoginError {
  error?: string
  details?: Array<{ message?: string }>
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json().catch(() => null)) as LoginError | null
      if (!res.ok) {
        setError(data?.error ?? data?.details?.[0]?.message ?? 'Login failed')
        return
      }
      // Session cookie is set via Set-Cookie; refresh server layout so the
      // header reflects the new session before/while navigating home.
      router.push('/')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true'

  return (
    <NexusLayout>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md bg-bg-panel border border-bg-border rounded-lg p-8">
          <h1 className="text-2xl font-mono font-bold text-teal-vivid mb-1">Sign in</h1>
          <p className="text-sm text-text-muted mb-6">Access your NEXUS terminal.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs uppercase tracking-wider text-text-muted font-mono mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 bg-bg-raised border border-border-dim rounded font-mono text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-teal-vivid"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs uppercase tracking-wider text-text-muted font-mono mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-bg-raised border border-border-dim rounded font-mono text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-teal-vivid"
              />
            </div>

            {error && <p className="text-sm text-data-bear" role="alert">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-4 text-sm text-text-muted">
            <Link href="/forgot-password" className="text-teal-vivid hover:text-teal-muted font-mono">
              Forgot password?
            </Link>
          </p>

          {googleEnabled && (
            <>
              <div className="my-4 flex items-center gap-2 text-xs text-text-muted">
                <span className="h-px flex-1 bg-border-dim" />
                or
                <span className="h-px flex-1 bg-border-dim" />
              </div>
              <Link
                href="/api/auth/signin/google"
                className="block w-full py-2 text-center bg-bg-raised border border-border-dim text-text-primary font-mono text-sm rounded hover:border-teal-vivid transition-colors"
              >
                Continue with Google
              </Link>
            </>
          )}

          <p className="mt-6 text-sm text-text-muted">
            No account?{' '}
            <Link href="/signup" className="text-teal-vivid hover:text-teal-muted font-mono">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}