import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getAuditLog, getAuditStats } from '@/lib/compliance'

export const dynamic = 'force-dynamic'

// GET /api/v1/compliance
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'log'

  try {
    if (action === 'log') {
      const category = searchParams.get('category') ?? undefined
      const severity = searchParams.get('severity') ?? undefined
      const limit = Number.parseInt(searchParams.get('limit') ?? '100')

      const events = getAuditLog({
        category: category as 'TRADE' | 'ORDER' | 'POSITION' | 'ACCOUNT' | 'SYSTEM' | 'COMPLIANCE' | 'RISK' | undefined,
        severity: severity as 'INFO' | 'WARNING' | 'CRITICAL' | undefined,
        limit,
      })

      return apiJson({ events, count: events.length })
    }

    if (action === 'stats') {
      const stats = getAuditStats()
      return apiJson(stats)
    }

    return apiJson(null, { error: `Unknown action: ${action}`, status: 400 })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 500 })
  }
}
