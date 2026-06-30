"use client"

import { useState, useEffect, useCallback } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Position {
  symbol: string
  qty: string
  avgEntryPrice: string
  currentPrice: string
  marketValue: string
  unrealizedPnl: string
  unrealizedPnlPct: string
  side: string
}

interface Order {
  id: string
  symbol: string
  qty: string
  side: string
  type: string
  status: string
  filled_avg_price: string | null
  filled_qty: string
  submitted_at: string
  filled_at: string | null
}

interface Account {
  cash: string
  portfolio_value: string
  buying_power: string
  equity: string
  long_market_value: string
  unrealized_pl: string
  unrealized_plpc: string
}

export default function TradingPage() {
  const [account, setAccount] = useState<Account | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'new-order'>('positions')
  const [newOrder, setNewOrder] = useState({
    symbol: '',
    side: 'buy' as 'buy' | 'sell',
    type: 'market' as 'market' | 'limit',
    qty: '',
    limitPrice: '',
  })
  const [orderStatus, setOrderStatus] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [acctRes, posRes, ordRes] = await Promise.all([
        fetch('/api/v1/trading/account'),
        fetch('/api/v1/trading/positions'),
        fetch('/api/v1/trading/orders?status=all&limit=20'),
      ])

      if (acctRes.ok) {
        const acctData = await acctRes.json()
        setAccount(acctData.data)
      }
      if (posRes.ok) {
        const posData = await posRes.json()
        setPositions(posData.data ?? [])
      }
      if (ordRes.ok) {
        const ordData = await ordRes.json()
        setOrders(ordData.data ?? [])
      }

      setLoading(false)
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [fetchData])

  const handlePlaceOrder = async () => {
    if (!newOrder.symbol || !newOrder.qty) return
    setOrderStatus(null)

    try {
      const res = await fetch('/api/v1/trading/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: newOrder.symbol.toUpperCase(),
          side: newOrder.side,
          type: newOrder.type,
          qty: Number.parseFloat(newOrder.qty),
          limit_price: newOrder.type === 'limit' ? Number.parseFloat(newOrder.limitPrice) : undefined,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setOrderStatus(`Order placed: ${newOrder.side.toUpperCase()} ${newOrder.qty} ${newOrder.symbol.toUpperCase()}`)
        setNewOrder({ symbol: '', side: 'buy', type: 'market', qty: '', limitPrice: '' })
        fetchData() // Refresh
      } else {
        setOrderStatus(`Error: ${data.error}`)
      }
    } catch (err) {
      setOrderStatus(`Error: ${(err as Error).message}`)
    }
  }

  const handleCancelOrder = async (orderId: string) => {
    try {
      await fetch(`/api/v1/trading/orders/${orderId}`, { method: 'DELETE' })
      fetchData()
    } catch { /* ignore */ }
  }

  const fmt = (n: string | number | null | undefined, decimals = 2) => {
    if (n == null) return '—'
    const num = typeof n === 'string' ? Number.parseFloat(n) : n
    if (Number.isNaN(num)) return '—'
    return num.toLocaleString(undefined, { maximumFractionDigits: decimals })
  }

  const fmtPnl = (n: string | null | undefined) => {
    if (n == null) return '—'
    const num = Number.parseFloat(n)
    if (Number.isNaN(num)) return '—'
    return `${num >= 0 ? '+' : ''}$${num.toFixed(2)}`
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">TRADING TERMINAL</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Alpaca Paper Trading · Commission-free · Real-time
            </p>
          </div>
          <LiveDot status={loading ? 'stale' : error ? 'error' : 'live'} label />
        </div>

        {error && (
          <div className="text-data-bear text-[11px] font-mono p-4 bg-bg-panel border border-border-dim rounded">
            Error: {error}
          </div>
        )}

        {/* Account Summary */}
        {account && (
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-[10px] text-text-muted font-mono">PORTFOLIO VALUE</p>
              <p className="text-xl font-bold font-mono text-text-primary">${fmt(account.portfolio_value)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-[10px] text-text-muted font-mono">CASH</p>
              <p className="text-xl font-bold font-mono text-text-primary">${fmt(account.cash)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-[10px] text-text-muted font-mono">BUYING POWER</p>
              <p className="text-xl font-bold font-mono text-text-primary">${fmt(account.buying_power)}</p>
            </div>
            <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
              <p className="text-[10px] text-text-muted font-mono">UNREALIZED P&L</p>
              <p className={`text-xl font-bold font-mono ${Number.parseFloat(account.unrealized_pl ?? '0') >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                {fmtPnl(account.unrealized_pl)}
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border-dim">
          {(['positions', 'orders', 'new-order'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-mono transition-colors ${
                activeTab === tab
                  ? 'text-accent-cyan border-b-2 border-accent-cyan font-bold'
                  : 'text-text-muted hover:text-text-primary'
              }`}>
              {tab === 'positions' ? `Positions (${positions.length})` : tab === 'orders' ? `Orders (${orders.length})` : 'New Order'}
            </button>
          ))}
        </div>

        {/* Positions */}
        {activeTab === 'positions' && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            {positions.length === 0 ? (
              <p className="text-xs text-text-dim p-4 text-center">No open positions</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <th className="text-left py-2 font-mono">SYMBOL</th>
                      <th className="text-right py-2 font-mono">QTY</th>
                      <th className="text-right py-2 font-mono">AVG COST</th>
                      <th className="text-right py-2 font-mono">CURRENT</th>
                      <th className="text-right py-2 font-mono">MKT VALUE</th>
                      <th className="text-right py-2 font-mono">P&L</th>
                      <th className="text-right py-2 font-mono">P&L %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(pos => (
                      <tr key={pos.symbol} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 font-mono text-accent-cyan font-bold">{pos.symbol}</td>
                        <td className="py-2 text-right font-mono">{pos.qty}</td>
                        <td className="py-2 text-right font-mono">${fmt(pos.avgEntryPrice)}</td>
                        <td className="py-2 text-right font-mono">${fmt(pos.currentPrice)}</td>
                        <td className="py-2 text-right font-mono">${fmt(pos.marketValue)}</td>
                        <td className={`py-2 text-right font-mono font-bold ${Number.parseFloat(pos.unrealizedPnl ?? '0') >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                          {fmtPnl(pos.unrealizedPnl)}
                        </td>
                        <td className={`py-2 text-right font-mono ${Number.parseFloat(pos.unrealizedPnlPct ?? '0') >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                          {fmt(pos.unrealizedPnlPct ? Number.parseFloat(pos.unrealizedPnlPct) * 100 : null)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Orders */}
        {activeTab === 'orders' && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            {orders.length === 0 ? (
              <p className="text-xs text-text-dim p-4 text-center">No orders</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border-dim">
                      <th className="text-left py-2 font-mono">TIME</th>
                      <th className="text-left py-2 font-mono">SYMBOL</th>
                      <th className="text-right py-2 font-mono">SIDE</th>
                      <th className="text-right py-2 font-mono">TYPE</th>
                      <th className="text-right py-2 font-mono">QTY</th>
                      <th className="text-right py-2 font-mono">FILLED</th>
                      <th className="text-right py-2 font-mono">STATUS</th>
                      <th className="text-right py-2 font-mono">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(order => (
                      <tr key={order.id} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                        <td className="py-2 font-mono text-text-muted">{new Date(order.submitted_at).toLocaleString()}</td>
                        <td className="py-2 font-mono text-accent-cyan">{order.symbol}</td>
                        <td className={`py-2 text-right font-mono font-bold ${order.side === 'buy' ? 'text-data-bull' : 'text-data-bear'}`}>
                          {order.side.toUpperCase()}
                        </td>
                        <td className="py-2 text-right font-mono text-text-muted">{order.type}</td>
                        <td className="py-2 text-right font-mono">{order.qty}</td>
                        <td className="py-2 text-right font-mono">{order.filled_qty}/{order.qty}</td>
                        <td className={`py-2 text-right font-mono ${
                          order.status === 'filled' ? 'text-data-bull' :
                          order.status === 'canceled' ? 'text-text-muted' :
                          order.status === 'rejected' ? 'text-data-bear' : 'text-accent-cyan'
                        }`}>
                          {order.status}
                        </td>
                        <td className="py-2 text-right">
                          {['new', 'partially_filled', 'pending_new'].includes(order.status) && (
                            <button onClick={() => handleCancelOrder(order.id)}
                              className="text-[10px] font-mono text-data-bear hover:text-data-bear/80">
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* New Order */}
        {activeTab === 'new-order' && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-cyan mb-3">PLACE ORDER (ALPACA PAPER TRADING)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Symbol</label>
                <input type="text" value={newOrder.symbol}
                  onChange={e => setNewOrder(prev => ({ ...prev, symbol: e.target.value }))}
                  placeholder="AAPL"
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Quantity</label>
                <input type="number" value={newOrder.qty}
                  onChange={e => setNewOrder(prev => ({ ...prev, qty: e.target.value }))}
                  placeholder="10"
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Side</label>
                <div className="flex gap-2">
                  {(['buy', 'sell'] as const).map(side => (
                    <button key={side} onClick={() => setNewOrder(prev => ({ ...prev, side }))}
                      className={`flex-1 px-3 py-2 text-xs font-mono rounded border ${
                        newOrder.side === side
                          ? side === 'buy' ? 'bg-data-bull text-white border-data-bull' : 'bg-data-bear text-white border-data-bear'
                          : 'bg-bg-elevated border-border-dim text-text-muted'
                      }`}>
                      {side.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Type</label>
                <select value={newOrder.type}
                  onChange={e => setNewOrder(prev => ({ ...prev, type: e.target.value as 'market' | 'limit' }))}
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary">
                  <option value="market">Market</option>
                  <option value="limit">Limit</option>
                </select>
              </div>
              {newOrder.type === 'limit' && (
                <div>
                  <label className="text-[10px] text-text-muted font-mono block mb-1">Limit Price</label>
                  <input type="number" value={newOrder.limitPrice}
                    onChange={e => setNewOrder(prev => ({ ...prev, limitPrice: e.target.value }))}
                    placeholder="195.50"
                    className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary" />
                </div>
              )}
            </div>
            <div className="mt-4 flex items-center gap-4">
              <button onClick={handlePlaceOrder}
                className={`px-6 py-3 text-sm font-mono font-bold rounded ${
                  newOrder.side === 'buy' ? 'bg-data-bull text-white hover:bg-data-bull/80' : 'bg-data-bear text-white hover:bg-data-bear/80'
                }`}>
                {newOrder.side.toUpperCase()} {newOrder.symbol || '...'}
              </button>
              {orderStatus && (
                <span className="text-xs font-mono text-accent-cyan">{orderStatus}</span>
              )}
            </div>
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">BROKER</h2>
          <p className="text-xs text-text-dim">
            Alpaca Paper Trading — commission-free US stock trading with virtual money.
            Real market data, real order execution, zero risk.
            Set ALPACA_API_KEY and ALPACA_SECRET_KEY to connect.
          </p>
        </div>
      </div>
    </NexusLayout>
  )
}
