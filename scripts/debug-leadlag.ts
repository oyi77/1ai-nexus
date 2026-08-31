// One-off diagnostic — surfaces the real runtime error behind /api/v1/lead-lag 502
import { readFileSync } from 'fs'

// Load .env (Prisma reads DATABASE_URL from process.env)
try {
  const env = readFileSync('.env', 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) {
      const v = m[2].trim().replace(/^["']|["']$/g, '')
      if (!(m[1] in process.env)) process.env[m[1]] = v
    }
  }
} catch {
  // no .env — rely on ambient env
}

interface ErrLike {
  code?: string
  message?: string
  stack?: string
  constructor?: { name?: string }
}

function errOf(e: unknown): ErrLike {
  return (e ?? {}) as ErrLike
}

async function main() {
  const { computeLeadLag, fetchLeadLag } = await import(
    '@/lib/modules/derived/lead-lag-engine'
  )
  const { prisma } = await import('@/lib/db')

  // 1) Does MarketSnapshot table exist / have rows?
  try {
    const c = await prisma.marketSnapshot.count()
    console.log('marketSnapshot.count =', c)
  } catch (e) {
    const err = errOf(e)
    console.error('marketSnapshot.count ERR:', err.code, err.message)
  }

  // 2) Does LeadLagMatrix table exist?
  try {
    const c = await prisma.leadLagMatrix.count()
    console.log('leadLagMatrix.count =', c)
  } catch (e) {
    const err = errOf(e)
    console.error('leadLagMatrix.count ERR:', err.code, err.message)
  }

  // 3) Run computeLeadLag on BTC
  try {
    const r = await computeLeadLag('BTC')
    console.log('computeLeadLag BTC =', r ? 'ROW' : 'null')
  } catch (e) {
    const err = errOf(e)
    console.error('computeLeadLag ERR:', err.constructor?.name, err.code, err.message)
    console.error(err.stack?.split('\n').slice(0, 8).join('\n'))
  }

  // 4) fetchLeadLag
  try {
    const rows = await fetchLeadLag()
    console.log('fetchLeadLag count =', rows.length)
  } catch (e) {
    const err = errOf(e)
    console.error('fetchLeadLag ERR:', err.constructor?.name, err.code, err.message)
    console.error(err.stack?.split('\n').slice(0, 8).join('\n'))
  }
}

main()
  .catch((e) => console.error('FATAL', e))
  .finally(() => process.exit(0))
