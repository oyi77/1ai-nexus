import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getStablecoinFlows, getNetMintBurn } from '@/lib/modules/derived/stablecoin-flow'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'flows'

  try {
    if (action === 'net') {
      const net = await getNetMintBurn()
      return NextResponse.json({ data: net, error: null }, {
        headers: { 'Cache-Control': 'public, max-age=60' },
      })
    }

    const flows = await getStablecoinFlows()
    return NextResponse.json({ data: flows, count: flows.length, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    })
  } catch (err) {
    return NextResponse.json({ data: [], error: (err as Error).message }, { status: 502 })
  }
}
