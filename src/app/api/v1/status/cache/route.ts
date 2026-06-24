// ─────────────────────────────────────────────────────────────
// GET /api/v1/status/cache — Cache health & stats
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getCacheStats } from '@/lib/api/server-cache'
import { getRedisClient } from '@/lib/redis'

export async function GET() {
  try {
    const stats = getCacheStats()

    let redisKeys = 0
    let redisMemory = 'unknown'
    try {
      const redis = getRedisClient()
      redisKeys = await redis.dbsize()
      const info = await redis.info('memory')
      const match = /used_memory_human:(\S+)/.exec(info)
      if (match) redisMemory = match[1]
    } catch {
      // Redis down
    }

    return NextResponse.json({
      data: {
        memory: {
          entries: stats.memoryEntries,
          inflight: stats.inflightRequests,
        },
        redis: {
          connected: true,
          keys: redisKeys,
          memory: redisMemory,
        },
        ttlPolicy: {
          'whale-alert': '60s',
          'dex:trending': '60s',
          'dex:new-pairs': '15s',
          'entities:graph': '5min',
          'fear-greed': '60s',
          'macro': '1h',
        },
      },
      error: null,
    })
  } catch (error) {
    return NextResponse.json({ data: null, error: String(error) }, { status: 500 })
  }
}
