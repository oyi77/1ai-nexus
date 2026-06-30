"use client"

import { useState, useEffect } from 'react'
import { NexusLayout } from '@/components/layout/NexusLayout'
import { LiveDot } from '@/components/primitives/LiveDot'

interface Order {
  id: string
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT'
  quantity: number
  price: number | null
  stopPrice: number | null
  status: 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED'
  filledQuantity: number
  avgFillPrice: number | null
  timestamp: string
  broker: string
}

interface Position {
  symbol: string
  quantity: number
  avgCost: number
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
}

interface Account {
  broker: string
  balance: number
  buyingPower: number
  equity: number
  positions: Position[]
}

// Simulated trading data
const SAMPLE_ORDERS: Order[] = [
  { id: '1', symbol: 'AAPL', side: 'BUY', type: 'LIMIT', quantity: 100, price: 195.50, stopPrice: null, status: 'FILLED', filledQuantity: 100, avgFillPrice: 195.50, timestamp: '2026-06-30T10:30:00Z', broker: 'Alpaca' },
  { id: '2', symbol: 'BTC-USD', side: 'BUY', type: 'MARKET', quantity: 0.5, price: null, stopPrice: null, status: 'FILLED', filledQuantity: 0.5, avgFillPrice: 70250.00, timestamp: '2026-06-30T09:15:00Z', broker: 'Binance' },
  { id: '3', symbol: 'MSFT', side: 'BUY', type: 'LIMIT', quantity: 50, price: 448.00, stopPrice: null, status: 'FILLED', filledQuantity: 50, avgFillPrice: 448.00, timestamp: '2026-06-29T14:45:00Z', broker: 'Alpaca' },
  { id: '4', symbol: 'ETH-USD', side: 'SELL', type: 'LIMIT', quantity: 2.0, price: 3850.00, stopPrice: null, status: 'PENDING', filledQuantity: 0, avgFillPrice: null, timestamp: '2026-06-30T11:00:00Z', broker: 'Binance' },
  { id: '5', symbol: 'NVDA', side: 'BUY', type: 'STOP_LIMIT', quantity: 25, price: 128.00, stopPrice: 130.00, status: 'PENDING', filledQuantity: 0, avgFillPrice: null, timestamp: '2026-06-30T11:30:00Z', broker: 'Alpaca' },
  { id: '6', symbol: 'TSLA', side: 'SELL', type: 'MARKET', quantity: 10, price: null, stopPrice: null, status: 'FILLED', filledQuantity: 10, avgFillPrice: 248.75, timestamp: '2026-06-28T16:00:00Z', broker: 'Alpaca' },
]

const SAMPLE_POSITIONS: Position[] = [
  { symbol: 'AAPL', quantity: 100, avgCost: 195.50, currentPrice: 198.25, marketValue: 19825, unrealizedPnl: 275, unrealizedPnlPercent: 1.41 },
  { symbol: 'BTC-USD', quantity: 0.5, avgCost: 70250, currentPrice: 71500, marketValue: 35750, unrealizedPnl: 625, unrealizedPnlPercent: 1.78 },
  { symbol: 'MSFT', quantity: 50, avgCost: 448, currentPrice: 452.30, marketValue: 22615, unrealizedPnl: 215, unrealizedPnlPercent: 0.96 },
  { symbol: 'NVDA', quantity: 25, avgCost: 125.50, currentPrice: 132.80, marketValue: 3320, unrealizedPnl: 182.50, unrealizedPnlPercent: 5.82 },
]

export default function TradingPage() {
  const [orders, setOrders] = useState<Order[]>(SAMPLE_ORDERS)
  const [positions] = useState<Position[]>(SAMPLE_POSITIONS)
  const [activeTab, setActiveTab] = useState<'orders' | 'positions' | 'new-order'>('positions')
  const [newOrder, setNewOrder] = useState({
    symbol: '',
    side: 'BUY' as 'BUY' | 'SELL',
    type: 'LIMIT' as 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT',
    quantity: '',
    price: '',
    broker: 'Alpaca',
  })

  const totalEquity = positions.reduce((s, p) => s + p.marketValue, 0)
  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0)
  const totalPnlPercent = totalEquity > 0 ? (totalPnl / (totalEquity - totalPnl)) * 100 : 0

  const handleSubmitOrder = () => {
    if (!newOrder.symbol || !newOrder.quantity) return
    const order: Order = {
      id: Date.now().toString(),
      symbol: newOrder.symbol.toUpperCase(),
      side: newOrder.side,
      type: newOrder.type,
      quantity: Number.parseFloat(newOrder.quantity),
      price: newOrder.price ? Number.parseFloat(newOrder.price) : null,
      stopPrice: null,
      status: 'PENDING',
      filledQuantity: 0,
      avgFillPrice: null,
      timestamp: new Date().toISOString(),
      broker: newOrder.broker,
    }
    setOrders(prev => [order, ...prev])
    setNewOrder({ symbol: '', side: 'BUY', type: 'LIMIT', quantity: '', price: '', broker: 'Alpaca' })
    setActiveTab('orders')
  }

  return (
    <NexusLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold font-mono text-accent-cyan">TRADING TERMINAL</h1>
            <p className="text-xs text-text-muted font-mono mt-1">
              Multi-broker execution · Alpaca (US stocks) · Binance (Crypto)
            </p>
          </div>
          <LiveDot status="live" label />
        </div>

        {/* Account Summary */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">TOTAL EQUITY</p>
            <p className="text-xl font-bold font-mono text-text-primary">${totalEquity.toLocaleString()}</p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">UNREALIZED P&L</p>
            <p className={`text-xl font-bold font-mono ${totalPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">P&L %</p>
            <p className={`text-xl font-bold font-mono ${totalPnlPercent >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
              {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
            </p>
          </div>
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <p className="text-[10px] text-text-muted font-mono">OPEN POSITIONS</p>
            <p className="text-xl font-bold font-mono text-text-primary">{positions.length}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border-dim">
          {(['positions', 'orders', 'new-order'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-mono transition-colors ${
                activeTab === tab
                  ? 'text-accent-cyan border-b-2 border-accent-cyan font-bold'
                  : 'text-text-muted hover:text-text-primary'
              }`}>
              {tab === 'positions' ? 'Positions' : tab === 'orders' ? 'Orders' : 'New Order'}
            </button>
          ))}
        </div>

        {/* Positions Tab */}
        {activeTab === 'positions' && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-cyan mb-3">OPEN POSITIONS</h3>
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
                      <td className="py-2 text-right font-mono">{pos.quantity}</td>
                      <td className="py-2 text-right font-mono">${pos.avgCost.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono">${pos.currentPrice.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono">${pos.marketValue.toLocaleString()}</td>
                      <td className={`py-2 text-right font-mono font-bold ${pos.unrealizedPnl >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                        {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                      </td>
                      <td className={`py-2 text-right font-mono ${pos.unrealizedPnlPercent >= 0 ? 'text-data-bull' : 'text-data-bear'}`}>
                        {pos.unrealizedPnlPercent >= 0 ? '+' : ''}{pos.unrealizedPnlPercent.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-cyan mb-3">ORDER HISTORY</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border-dim">
                    <th className="text-left py-2 font-mono">TIME</th>
                    <th className="text-left py-2 font-mono">SYMBOL</th>
                    <th className="text-right py-2 font-mono">SIDE</th>
                    <th className="text-right py-2 font-mono">TYPE</th>
                    <th className="text-right py-2 font-mono">QTY</th>
                    <th className="text-right py-2 font-mono">PRICE</th>
                    <th className="text-right py-2 font-mono">FILLED</th>
                    <th className="text-right py-2 font-mono">STATUS</th>
                    <th className="text-right py-2 font-mono">BROKER</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(order => (
                    <tr key={order.id} className="border-b border-border-dim/30 hover:bg-bg-elevated">
                      <td className="py-2 font-mono text-text-muted">{new Date(order.timestamp).toLocaleString()}</td>
                      <td className="py-2 font-mono text-accent-cyan">{order.symbol}</td>
                      <td className={`py-2 text-right font-mono font-bold ${order.side === 'BUY' ? 'text-data-bull' : 'text-data-bear'}`}>
                        {order.side}
                      </td>
                      <td className="py-2 text-right font-mono text-text-muted">{order.type}</td>
                      <td className="py-2 text-right font-mono">{order.quantity}</td>
                      <td className="py-2 text-right font-mono">{order.price ? `$${order.price.toFixed(2)}` : 'MARKET'}</td>
                      <td className="py-2 text-right font-mono">{order.filledQuantity}/{order.quantity}</td>
                      <td className={`py-2 text-right font-mono ${
                        order.status === 'FILLED' ? 'text-data-bull' :
                        order.status === 'PENDING' ? 'text-accent-cyan' :
                        order.status === 'CANCELLED' ? 'text-text-muted' : 'text-data-bear'
                      }`}>
                        {order.status}
                      </td>
                      <td className="py-2 text-right font-mono text-text-muted">{order.broker}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* New Order Tab */}
        {activeTab === 'new-order' && (
          <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
            <h3 className="text-xs font-mono text-accent-cyan mb-3">PLACE NEW ORDER</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Symbol</label>
                <input
                  type="text"
                  value={newOrder.symbol}
                  onChange={e => setNewOrder(prev => ({ ...prev, symbol: e.target.value }))}
                  placeholder="AAPL, BTC-USD, etc."
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Broker</label>
                <select
                  value={newOrder.broker}
                  onChange={e => setNewOrder(prev => ({ ...prev, broker: e.target.value }))}
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary"
                >
                  <option value="Alpaca">Alpaca (US Stocks)</option>
                  <option value="Binance">Binance (Crypto)</option>
                  <option value="Indodax">Indodax (IDR Crypto)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Side</label>
                <div className="flex gap-2">
                  {(['BUY', 'SELL'] as const).map(side => (
                    <button key={side} onClick={() => setNewOrder(prev => ({ ...prev, side }))}
                      className={`flex-1 px-3 py-2 text-xs font-mono rounded border ${
                        newOrder.side === side
                          ? side === 'BUY' ? 'bg-data-bull text-white border-data-bull' : 'bg-data-bear text-white border-data-bear'
                          : 'bg-bg-elevated border-border-dim text-text-muted'
                      }`}>
                      {side}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Order Type</label>
                <select
                  value={newOrder.type}
                  onChange={e => setNewOrder(prev => ({ ...prev, type: e.target.value as 'MARKET' | 'LIMIT' }))}
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary"
                >
                  <option value="MARKET">Market</option>
                  <option value="LIMIT">Limit</option>
                  <option value="STOP">Stop</option>
                  <option value="STOP_LIMIT">Stop Limit</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Quantity</label>
                <input
                  type="number"
                  value={newOrder.quantity}
                  onChange={e => setNewOrder(prev => ({ ...prev, quantity: e.target.value }))}
                  placeholder="100"
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-muted font-mono block mb-1">Price (for Limit orders)</label>
                <input
                  type="number"
                  value={newOrder.price}
                  onChange={e => setNewOrder(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="195.50"
                  className="w-full px-3 py-2 text-xs font-mono bg-bg-elevated border border-border-dim rounded text-text-primary"
                />
              </div>
            </div>
            <button onClick={handleSubmitOrder}
              className={`mt-4 px-6 py-3 text-sm font-mono font-bold rounded ${
                newOrder.side === 'BUY' ? 'bg-data-bull text-white hover:bg-data-bull/80' : 'bg-data-bear text-white hover:bg-data-bear/80'
              }`}>
              {newOrder.side} {newOrder.symbol || '...'}
            </button>
          </div>
        )}

        <div className="bg-bg-panel border border-border-dim rounded-lg p-4">
          <h2 className="text-xs font-mono text-accent-cyan mb-2">BROKER INTEGRATION</h2>
          <div className="grid grid-cols-3 gap-4 text-xs text-text-dim">
            <div>
              <p className="font-mono text-text-primary mb-1">Alpaca (US Stocks)</p>
              <p>Commission-free US stock trading. Paper trading available for testing.</p>
            </div>
            <div>
              <p className="font-mono text-text-primary mb-1">Binance (Crypto)</p>
              <p>Largest crypto exchange. Spot and futures trading. Low fees.</p>
            </div>
            <div>
              <p className="font-mono text-text-primary mb-1">Indodax (IDR Crypto)</p>
              <p>Indonesian crypto exchange. IDR trading pairs. Local compliance.</p>
            </div>
          </div>
        </div>
      </div>
    </NexusLayout>
  )
}
