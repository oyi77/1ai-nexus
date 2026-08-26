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
} catch (e) {
  console.error('env load err', e)
}

async function main() {
  const { computeLeadLag, computeAndStoreLeadLag, fetchLeadLag } = await import(
    '@/lib/modules/derived/lead-lag-engine'
  )
  const { prisma } = await import('@/lib/db')

  // 1) Does MarketSnapshot table exist / have rows?
  try {
    const c = await prisma.marketSnapshot.count()
    console.log('marketSnapshot.count =', c)
  } catch (e: any) {
    console.error('marketSnapshot.count ERR:', e?.code, e?.message)
  }

  // 2) Does LeadLagMatrix table exist?
  try {
    const c = await prisma.leadLagMatrix.count()
    console.log('leadLagMatrix.count =', c)
  } catch (e: any) {
    console.error('leadLagMatrix.count ERR:', e?.code, e?.message)
  }

  // 3) Run computeLeadLag on BTC
  try {
    const r = await computeLeadLag('BTC')
    console.log('computeLeadLag BTC =', r ? 'ROW' : 'null')
  } catch (e: any) {
    console.error('computeLeadLag ERR:', e?.constructor?.name, e?.code, e?.message)
    console.error(e?.stack?.split('\n').slice(0, 8).join('\n'))
  }

  // 4) fetchLeadLag
  try {
    const rows = await fetchLeadLag()
    console.log('fetchLeadLag count =', rows.length)
  } catch (e: any) {
    console.error('fetchLeadLag ERR:', e?.constructor?.name, e?.code, e?.message)
    console.error(e?.stack?.split('\n').slice(0, 8).join('\n'))
  }
}

main()
  .catch((e) => console.error('FATAL', e))
  .finally(() => process.exit(0))
