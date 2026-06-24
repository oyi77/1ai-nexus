import { NextResponse } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getGasPrices } from '@/lib/modules/derived/gas-tracker'

export async function GET() {
  try {
    const prices = await getGasPrices()
    return NextResponse.json({ data: prices, error: null }, {
      headers: { 'Cache-Control': 'public, max-age=30' },
    })
  } catch (err) {
    return NextResponse.json({ data: [], error: (err as Error).message }, { status: 502 })
  }
}
