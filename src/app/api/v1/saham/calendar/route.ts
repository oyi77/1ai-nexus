// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/calendar — live dividend/corp-action events.
// Needs staged Stockbit session; 503-safe when absent.
// ─────────────────────────────────────────────────────────────
import { type NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/admin-auth'
import { getCalendar } from '@/lib/modules/market/provider/idx-calendar'
import { EmptySnapshotError } from '@/lib/modules/market/provider/idx-stockbit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    return apiSuccess(await getCalendar())
  } catch (error) {
    if (error instanceof EmptySnapshotError) {
      // U4: staging hint is admin-only; the public sees a generic message.
      if (await requireAdmin(request)) {
        return apiError('No Stockbit session — calendar needs STOCKBIT_REFRESH_TOKEN staged', 503)
      }
      return apiError('Temporarily unavailable — showing again after the next data sync.', 503)
    }
    return apiError((error as Error).message, 500)
  }
}
