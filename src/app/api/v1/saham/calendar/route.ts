// ─────────────────────────────────────────────────────────────
// GET /api/v1/saham/calendar — live dividend/corp-action events.
// Needs staged Stockbit session; 503-safe when absent.
// ─────────────────────────────────────────────────────────────

import { apiSuccess, apiError } from '@/lib/api/response'
import { getCalendar } from '@/lib/modules/market/provider/idx-calendar'
import { EmptySnapshotError } from '@/lib/modules/market/provider/idx-stockbit'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return apiSuccess(await getCalendar())
  } catch (error) {
    if (error instanceof EmptySnapshotError) {
      return apiError('No Stockbit session — calendar needs STOCKBIT_REFRESH_TOKEN staged', 503)
    }
    return apiError((error as Error).message, 500)
  }
}
