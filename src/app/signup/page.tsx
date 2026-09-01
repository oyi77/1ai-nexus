"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { NexusLayout } from "@/components/layout/NexusLayout"
import { LoaderCircle, Check } from "lucide-react"

// Client-side mirror of src/lib/password.ts validatePasswordStrength()
// so the strength indicator gives live feedback before the API round-trip.
function getPasswordStrength(password: string): {
  score: number
  checks: { label: string; ok: boolean }[]
} {
  const checks = [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "Lowercase letter", ok: /[a-z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ]
  return { score: checks.filter((c) => c.ok).length, checks }
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"]
const STRENGTH_COLORS = ["bg-bg-border", "bg-data-bear", "bg-data-warn", "bg-teal-muted", "bg-teal-vivid"]

export default function SignupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect") || "/welcome"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { score, checks } = getPasswordStrength(password)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Client-side gate mirroring the API's strength rules (fast feedback).
    if (!checks.every((c) => c.ok)) {
      setError("Password does not meet the strength requirements.")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/v1/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      // The signup route sets HTTP-only nexus-session / nexus-refresh cookies
      // via Set-Cookie — the browser stores them automatically for this origin.
      if (res.status === 201) {
        router.push(redirectTo)
        router.refresh() // let the server layout re-read the session cookie
        return
      }

      const data = await res.json().catch(() => null)
      const message: string = data?.error ?? `Signup failed (${res.status})`

      // API returns { error, details[] } for invalid input / weak password.
      const detail = data?.details
      const firstDetail =
        Array.isArray(detail) && detail.length > 0
          ? typeof detail[0] === "string"
            ? detail[0]
            : detail[0]?.message
          : null

      setError(firstDetail || message)
    } catch {
      setError("Network error — please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <NexusLayout>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md bg-bg-panel border border-bg-border rounded-lg p-8">
          {/* Header */}
          <h1 className="text-2xl font-mono font-bold text-teal-vivid">Create Account</h1>
          <p className="mt-2 text-sm text-text-muted">
            Sign up for a free NEXUS account to access your dashboard and API keys.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="signup-email" className="text-xs uppercase tracking-wider text-text-muted font-mono">
                Email
              </label>
              <input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 w-full px-3 py-2 bg-bg-raised border border-border-dim rounded font-mono text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-teal-vivid"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="signup-password" className="text-xs uppercase tracking-wider text-text-muted font-mono">
                Password
              </label>
              <input
                id="signup-password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 w-full px-3 py-2 bg-bg-raised border border-border-dim rounded font-mono text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-teal-vivid"
              />

              {/* Strength indicator */}
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">
                      Strength
                    </span>
                    <span className="text-[11px] font-mono text-text-secondary">{STRENGTH_LABELS[score]}</span>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded ${
                          i <= score ? STRENGTH_COLORS[score] : "bg-bg-border"
                        }`}
                      />
                    ))}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {checks.map((c) => (
                      <li key={c.label} className="flex items-center gap-1.5 text-[11px] font-mono">
                        <Check size={11} className={c.ok ? "text-teal-vivid" : "text-text-muted"} />
                        <span className={c.ok ? "text-text-secondary" : "text-text-muted"}>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Error */}
            {error && <p className="text-sm text-data-bear">{error}</p>}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-teal-vivid text-bg-base font-mono font-bold rounded hover:bg-teal-muted disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <LoaderCircle size={16} className="animate-spin" />}
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>

          {/* Link to login */}
          <p className="mt-6 text-sm text-text-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-teal-vivid hover:text-teal-muted">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
