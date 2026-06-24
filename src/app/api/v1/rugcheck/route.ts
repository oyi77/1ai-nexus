import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { checkTokenSafety } from '@/lib/modules/derived/rug-checker'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const address = searchParams.get('address')
    const chain = searchParams.get('chain') || 'eth'

    if (!address) {
      return NextResponse.json({ data: null, error: 'address parameter required' }, { status: 400 })
    }

    const result = checkTokenSafety(address, chain)
    return NextResponse.json({ data: result, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
    })
  } catch (err) {
    console.error('[rugcheck] Error:', err)
    return NextResponse.json({ data: null, error: (err as Error).message }, { status: 502 })
  }
}
