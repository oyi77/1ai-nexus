// ─────────────────────────────────────────────────────────────
// GET /api/v1/equities/universe
//   ?group=<peer-group-id>  → curated peer group symbols
//   (default)               → dynamic IDX listed-equity universe
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { PEER_GROUPS } from '@/lib/config/universe'
import { getIdxUniverse } from '@/lib/modules/market/provider/idx-universe'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const groupId = request.nextUrl.searchParams.get('group')

  if (groupId) {
    const group = PEER_GROUPS[groupId]
    if (!group) {
      return apiError(`Unknown peer group '${groupId}'. Available: ${Object.keys(PEER_GROUPS).join(', ')}`, 400)
    }
    return apiSuccess({ group: { id: groupId, ...group } })
  }

  try {
    const { stocks, meta } = await getIdxUniverse()
    return apiSuccess({ exchange: 'IDX', stocks, meta })
  } catch (error) {
    return apiError((error as Error).message, 502)
  }
}
