// ─── Real-Time Data Streaming Service ─────────────────────
// WebSocket connections for live price feeds across ALL asset classes.
// Replaces REST polling with sub-second updates.
// ─────────────────────────────────────────────────────────

export interface PriceUpdate {
  symbol: string
  price: number
  change: number
  changePercent: number
  volume: number
  timestamp: number
  source: string
}

type PriceCallback = (update: PriceUpdate) => void

class RealTimeDataService {
  private static instance: RealTimeDataService
  private subscribers: Map<string, Set<PriceCallback>> = new Map()
  private prices: Map<string, PriceUpdate> = new Map()
  private connections: Map<string, WebSocket> = new Map()
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  private constructor() {}

  static getInstance(): RealTimeDataService {
    if (!RealTimeDataService.instance) {
      RealTimeDataService.instance = new RealTimeDataService()
    }
    return RealTimeDataService.instance
  }

  subscribe(symbol: string, callback: PriceCallback): () => void {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set())
    }
    this.subscribers.get(symbol)!.add(callback)

    return () => {
      this.subscribers.get(symbol)?.delete(callback)
      if (this.subscribers.get(symbol)?.size === 0) {
        this.subscribers.delete(symbol)
        this.disconnect(symbol)
      }
    }
  }

  getPrice(symbol: string): PriceUpdate | null {
    return this.prices.get(symbol) ?? null
  }

  getAllPrices(): Map<string, PriceUpdate> {
    return new Map(this.prices)
  }

  private notify(symbol: string, update: PriceUpdate): void {
    this.prices.set(symbol, update)
    this.subscribers.get(symbol)?.forEach(cb => {
      try { cb(update) } catch { /* ignore callback errors */ }
    })
  }

  // Binance WebSocket for crypto
  connectBinance(symbols: string[]): void {
    const streams = symbols.map(s => `${s.toLowerCase()}@ticker`).join('/')
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`

    this.connect('binance', url, (data: Record<string, unknown>) => {
      const stream = data.data as Record<string, unknown>
      if (!stream) return

      const symbol = (stream.s as string)?.replace('USDT', '') ?? ''
      const price = Number.parseFloat(stream.c as string) || 0
      const change = Number.parseFloat(stream.P as string) || 0
      const volume = Number.parseFloat(stream.v as string) || 0

      this.notify(symbol, {
        symbol,
        price,
        change: price * (change / 100),
        changePercent: change,
        volume,
        timestamp: Date.now(),
        source: 'binance',
      })
    })
  }

  // Yahoo Finance polling for equities, forex, etc.
  connectYahoo(symbols: string[]): void {
    this.pollYahoo(symbols)
  }

  private async pollYahoo(symbols: string[]): Promise<void> {
    const poll = async () => {
      try {
        const symbolsStr = symbols.join(',')
        const res = await fetch(`/api/v1/modules/fetch?module=yahoo-finance&action=quote&symbols=${symbolsStr}`)
        const data = await res.json()

        for (const q of data.data ?? []) {
          this.notify(q.symbol, {
            symbol: q.symbol,
            price: q.regularMarketPrice ?? 0,
            change: q.regularMarketChange ?? 0,
            changePercent: q.regularMarketChangePercent ?? 0,
            volume: q.regularMarketVolume ?? 0,
            timestamp: Date.now(),
            source: 'yahoo',
          })
        }
      } catch {
        // Silent fail — will retry next interval
      }
    }

    await poll()
    setInterval(poll, 5000)
  }

  private connect(name: string, url: string, onMessage: (data: Record<string, unknown>) => void): void {
    if (this.connections.has(name)) {
      this.connections.get(name)?.close()
    }

    try {
      const ws = new WebSocket(url)

      ws.onopen = () => {
        console.log(`[RealTime] Connected to ${name}`)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string)
          onMessage(data)
        } catch {
          // Silent fail for parse errors
        }
      }

      ws.onclose = () => {
        console.log(`[RealTime] Disconnected from ${name}`)
        this.connections.delete(name)

        const timer = setTimeout(() => {
          console.log(`[RealTime] Reconnecting to ${name}...`)
          this.connect(name, url, onMessage)
        }, 3000)
        this.reconnectTimers.set(name, timer)
      }

      ws.onerror = () => {
        // Silent fail — onclose will handle reconnect
      }

      this.connections.set(name, ws)
    } catch {
      // Silent fail for connection errors
    }
  }

  private disconnect(_symbol: string): void {
    const hasSubscribers = this.subscribers.size > 0
    if (!hasSubscribers) {
      this.connections.forEach((ws, name) => {
        ws.close()
        clearTimeout(this.reconnectTimers.get(name))
      })
      this.connections.clear()
      this.reconnectTimers.clear()
    }
  }

  destroy(): void {
    this.connections.forEach((ws, name) => {
      ws.close()
      clearTimeout(this.reconnectTimers.get(name))
    })
    this.connections.clear()
    this.reconnectTimers.clear()
    this.subscribers.clear()
    this.prices.clear()
  }
}

export const realTimeService = RealTimeDataService.getInstance()
