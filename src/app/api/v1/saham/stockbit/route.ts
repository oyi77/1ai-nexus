// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/stockbit — Stockbit IDX intel from the nightly
// harvest snapshots (no auth needed by callers; upstream auth is
// server-side via STOCKBIT_REFRESH_TOKEN).
//   (default)             bandar snapshot universe + tradeDate
//   ?symbol=BBRI          single-stock bandar snapshot (+matrix)
//   ?leaders=acc|dist&limit=20   strongest concentration reads
//   ?guru=1               guru preset screens (latest snapshot)
//   ?analyst=1            analyst ratings universe
//   ?analyst=BBRI         single-stock analyst rating
// Empty DB (no harvest yet) → 503 with staging instructions.
// Unknown symbol with data present → 404.
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  getBandarSnapshots,
  getBandarSnapshot,
  getBandarLeaders,
  getGuruScreens,
  getAnalysts,
  getAnalyst,
  normalizeCode,
  EmptySnapshotError,
} from '@/lib/modules/market/provider/idx-stockbit'

export const dynamic = 'force-dynamic'

const NO_DATA =
  'No Stockbit snapshot yet — run npm run harvest:idx-stockbit with STOCKBIT_REFRESH_TOKEN staged (see local/stockbit-auth-re.md §14)'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  try {
    const symbol = q.get('symbol')
    if (symbol) {
      const row = await getBandarSnapshot(symbol)
      if (!row) return apiError(`No bandar snapshot for '${symbol}' in the latest harvest`, 404)
      return apiSuccess({ symbol: normalizeCode(symbol), ...row })
    }

    const leaders = q.get('leaders')
    if (leaders === 'acc' || leaders === 'dist') {
      const limit = Math.min(100, Math.max(1, Number(q.get('limit') ?? 20)))
      const rows = await getBandarLeaders(leaders, limit)
      return apiSuccess({ leaders, count: rows.length, items: rows })
    }

    if (q.has('guru')) {
      const screens = await getGuruScreens()
      return apiSuccess({ count: screens.length, screens })
    }

    if (q.has('analyst')) {
      const code = q.get('analyst')
      if (!code || code === '1') return apiSuccess(await getAnalysts())
      const row = await getAnalyst(code)
      if (!row) return apiError(`No analyst rating for '${code}' in the latest harvest`, 404)
      return apiSuccess({ symbol: normalizeCode(code), ...row })
    }

    return apiSuccess(await getBandarSnapshots())
  } catch (error) {
    if (error instanceof EmptySnapshotError) return apiError(NO_DATA, 503)
    return apiError((error as Error).message, 500)
  }
}
