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
// ─────────────────────────────────────────────────────────────

import { hasSessionCredentials as stockbitAvailable } from '@/lib/modules/market/provider/idx-stockbit/session'
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
      if (!row) {
        return stockbitAvailable()
          ? apiError(`No bandar snapshot for '${symbol}' in the latest harvest`, 404)
          : apiError(NO_DATA, 503)
      }
      return apiSuccess({ symbol: normalizeCode(symbol), ...row })
    }

    const leaders = q.get('leaders')
    if (leaders === 'acc' || leaders === 'dist') {
      const limit = Math.min(100, Math.max(1, Number(q.get('limit') ?? 20)))
      const rows = await getBandarLeaders(leaders, limit)
      if (rows.length === 0) {
        return stockbitAvailable() ? apiSuccess({ leaders, count: 0, items: [] }) : apiError(NO_DATA, 503)
      }
      return apiSuccess({ leaders, count: rows.length, items: rows })
    }

    if (q.has('guru')) {
      const screens = await getGuruScreens()
      if (screens.length === 0) {
        return stockbitAvailable() ? apiSuccess({ count: 0, screens: [] }) : apiError(NO_DATA, 503)
      }
      return apiSuccess({ count: screens.length, screens })
    }

    if (q.has('analyst')) {
      const code = q.get('analyst')
      if (!code || code === '1') {
        const snap = await getAnalysts()
        if (snap.count === 0) {
          return stockbitAvailable() ? apiSuccess({ count: 0, rows: [] }) : apiError(NO_DATA, 503)
        }
        return apiSuccess(snap)
      }
      const row = await getAnalyst(code)
      if (!row) {
        return stockbitAvailable()
          ? apiError(`No analyst rating for '${code}' in the latest harvest`, 404)
          : apiError(NO_DATA, 503)
      }
      return apiSuccess({ symbol: normalizeCode(code), ...row })
    }

    const snap = await getBandarSnapshots()
    if (snap.count === 0) {
      return stockbitAvailable() ? apiSuccess(snap) : apiError(NO_DATA, 503)
    }
    return apiSuccess(snap)
  } catch (error) {
    return apiError((error as Error).message, 500)
  }
}
