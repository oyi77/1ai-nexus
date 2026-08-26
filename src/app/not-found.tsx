import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg-base text-text-primary flex items-center justify-center">
      <div className="text-center px-6">
        <p className="text-7xl font-bold tracking-tight text-teal-vivid">404</p>
        <h1 className="mt-4 text-xl font-semibold">This page could not be found</h1>
        <p className="mt-2 text-sm text-text-secondary max-w-md">
          The instrument or page you are looking for does not exist, or has moved.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-vivid text-bg-void font-semibold hover:bg-teal-vivid/85 transition-colors"
          >
            Back to home
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-bg-border bg-bg-panel hover:border-border-active transition-colors"
          >
            Open terminal
          </Link>
        </div>
      </div>
    </div>
  )
}
