"use client"

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ message: string; devLink?: string; note?: string } | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'Request failed')
        return
      }
      setResult(data ?? { message: 'If that email exists, a reset link was sent.' })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <NexusLayout>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md bg-bg-panel border border-bg-border rounded-lg p-8">
          <h1 className="text-2xl font-mono font-bold text-teal-vivid mb-1">Reset Password</h1>
          <p className="text-sm text-text-muted mb-6">
            Enter your email and we&apos;ll send you a reset link.
          </p>

          {error && <p className="text-sm text-data-bear mb-4" role="alert">{error}</p>}

          {result ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">{result.message}</p>
              {result.devLink && (
                <a
                  href={result.devLink}
                  className="block break-all px-3 py-2 bg-bg-raised border border-border-dim rounded font-mono text-xs text-teal-vivid"
                >
                  {result.devLink}
                </a>
              )}
              {result.note && <p className="text-xs text-text-muted">{result.note}</p>}
              <Link href="/login" className="block text-sm text-teal-vivid hover:text-teal-muted font-mono">
                Back to Sign In
              </Link>
            </div>
          ) : (
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
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </NexusLayout>
  )
}