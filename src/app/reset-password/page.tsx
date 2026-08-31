"use client"

import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { NexusLayout } from '@/components/layout/NexusLayout'

export default function ResetPasswordPage() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'Reset failed')
        return
      }
      setDone(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <NexusLayout>
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md bg-bg-panel border border-bg-border rounded-lg p-8">
            <h1 className="text-xl font-bold text-text-primary mb-2">Invalid Reset Link</h1>
            <p className="text-sm text-text-secondary mb-4">
              This reset link is missing or invalid. Request a new one.
            </p>
            <Link href="/login" className="text-teal-vivid text-sm hover:underline">
              Back to Sign In
            </Link>
          </div>
        </div>
      </NexusLayout>
    )
  }

  if (done) {
    return (
      <NexusLayout>
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md bg-bg-panel border border-bg-border rounded-lg p-8 text-center">
            <h1 className="text-xl font-bold text-text-primary mb-2">Password Updated</h1>
            <p className="text-sm text-text-secondary mb-4">
              Your password has been reset. You can now sign in with your new password.
            </p>
            <Link
              href="/login"
              className="inline-block px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </NexusLayout>
    )
  }

  return (
    <NexusLayout>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md bg-bg-panel border border-bg-border rounded-lg p-8">
          <h1 className="text-xl font-bold text-text-primary mb-2">Reset Password</h1>
          <p className="text-sm text-text-secondary mb-6">Enter your new password below.</p>

          {error && (
            <div className="mb-4 px-3 py-2 bg-data-bear/15 border border-data-bear/30 rounded text-xs text-data-bear" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-text-muted mb-1" htmlFor="password">New Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full bg-bg-raised border border-bg-border rounded px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-teal-vivid"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1" htmlFor="confirm">Confirm Password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full bg-bg-raised border border-bg-border rounded px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-teal-vivid"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-vivid/80 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Resetting…' : 'Reset Password'}
            </button>
          </form>
        </div>
      </div>
    </NexusLayout>
  )
}