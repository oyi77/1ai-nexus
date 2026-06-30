import { type NextRequest } from 'next/server'
import { apiJson } from '@/lib/api/response'
import { getAccount, getPositions, getOrders, placeOrder, cancelOrder, getAlpacaStatus } from '@/lib/alpaca'
import { auditTrade, auditOrder } from '@/lib/compliance'

export const dynamic = 'force-dynamic'

// GET /api/v1/trading/account
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'account'

  try {
    const status = getAlpacaStatus()
    if (!status.configured) {
      return apiJson({ configured: false, mode: 'paper', message: 'Set ALPACA_API_KEY and ALPACA_SECRET_KEY to connect.' })
    }

    if (action === 'account') {
      const account = await getAccount()
      return apiJson(account)
    }

    if (action === 'positions') {
      const positions = await getPositions()
      return apiJson(positions)
    }

    if (action === 'orders') {
      const orderStatus = searchParams.get('status') ?? undefined
      const limit = Number.parseInt(searchParams.get('limit') ?? '50')
      const orders = await getOrders(orderStatus, limit)
      return apiJson(orders)
    }

    return apiJson(null, { error: `Unknown action: ${action}`, status: 400 })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 502 })
  }
}

// POST /api/v1/trading/orders
export async function POST(request: NextRequest) {
  try {
    const status = getAlpacaStatus()
    if (!status.configured) {
      return apiJson(null, { error: 'Alpaca not configured', status: 400 })
    }

    const body = await request.json() as {
      symbol: string
      side: 'buy' | 'sell'
      type: 'market' | 'limit'
      qty: number
      limit_price?: number
    }

    if (!body.symbol || !body.side || !body.qty) {
      return apiJson(null, { error: 'Missing required fields: symbol, side, qty', status: 400 })
    }

    const order = await placeOrder({
      symbol: body.symbol,
      qty: body.qty,
      side: body.side,
      type: body.type,
      limit_price: body.limit_price,
    })

    // Audit log
    auditOrder({
      userId: 'trader',
      action: 'ORDER_SUBMITTED',
      symbol: body.symbol,
      side: body.side.toUpperCase() as 'BUY' | 'SELL',
      qty: body.qty,
      type: body.type,
      price: body.limit_price,
      broker: 'Alpaca',
    })

    return apiJson(order)
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 502 })
  }
}

// DELETE /api/v1/trading/orders/[id]
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('id')
    if (!orderId) {
      return apiJson(null, { error: 'Missing order id', status: 400 })
    }

    await cancelOrder(orderId)

    auditOrder({
      userId: 'trader',
      action: 'ORDER_CANCELLED',
      symbol: '',
      side: 'BUY',
      qty: 0,
      type: '',
      broker: 'Alpaca',
    })

    return apiJson({ cancelled: orderId })
  } catch (err) {
    return apiJson(null, { error: (err as Error).message, status: 502 })
  }
}
