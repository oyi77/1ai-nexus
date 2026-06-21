import { NextResponse } from 'next/server'
import { checkTokenSafety } from '@/lib/modules/derived/rug-checker'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const address = searchParams.get('address')
  const chain = searchParams.get('chain') || 'eth'

  if (!address) {
    return NextResponse.json({ data: null, error: 'address parameter required' }, { status: 400 })
  }

  const result = checkTokenSafety(address, chain)
  return NextResponse.json({ data: result, error: null })
}
