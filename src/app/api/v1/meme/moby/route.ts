// GET /api/v1/meme/moby — Moby's authenticated screening surfaces.
// The server keeps the Privy credential private and exposes a small, validated
// dispatch API to the client: groups, launchpads, group tokens, chart, PnL.

import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  getMobyChart,
  listMobyGroupTokens,
  listMobyLaunchpads,
  listMobyPnlLeaderboard,
  listMobyScreenerGroups,
} from '@/lib/modules/meme/moby'

export const dynamic = 'force-dynamic'

type Surface = 'groups' | 'launchpads' | 'tokens' | 'chart' | 'pnl'

function required(value: string | null, name: string): string {
  if (!value?.trim()) throw new Error(`Missing required parameter: ${name}`)
  return value.trim()
}

function positiveInt(value: string | null, fallback: number, max: number): number {
  if (value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer')
  return Math.min(parsed, max)
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const rawSurface = q.get('surface')
  const validSurfaces: Surface[] = ['groups', 'launchpads', 'tokens', 'chart', 'pnl']

  if (!rawSurface || !validSurfaces.includes(rawSurface as Surface)) {
    return apiError('surface must be one of: groups, launchpads, tokens, chart, pnl', 400)
  }

  try {
    let data: unknown
    switch (rawSurface as Surface) {
      case 'groups':
        data = await listMobyScreenerGroups(required(q.get('network'), 'network'))
        break
      case 'launchpads':
        data = await listMobyLaunchpads(required(q.get('network'), 'network'))
        break
      case 'tokens':
        data = await listMobyGroupTokens(
          required(q.get('network'), 'network'),
          required(q.get('groupId'), 'groupId'),
          positiveInt(q.get('limit'), 25, 100),
        )
        break
      case 'chart':
        data = await getMobyChart(
          required(q.get('chain'), 'chain'),
          required(q.get('contract'), 'contract'),
        )
        break
      case 'pnl': {
        const window = q.get('window') ?? '24h'
        if (window !== '24h' && window !== '7d') {
          return apiError('window must be 24h or 7d', 400)
        }
        data = await listMobyPnlLeaderboard(window)
        break
      }
    }
    return apiSuccess(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Missing required parameter:') || message === 'limit must be a positive integer') {
      return apiError(message, 400)
    }
    return apiError(`Moby upstream request failed: ${message}`, 502)
  }
}
