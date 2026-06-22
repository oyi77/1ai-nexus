import { apiSuccess, apiError } from '@/lib/api/response'
import { registerAllModules } from '@/lib/modules'

export async function GET() {
  try {
    const registry = registerAllModules()
    const res = await registry.fetchOne<Record<string, unknown>>('market-flow', { action: 'get' })
    const response = apiSuccess(res.data)
    response.headers.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    return response
  } catch (err) {
    console.error('[api/v1/market/flow] Error:', err)
    return apiError(String(err), 502)
  }
}
