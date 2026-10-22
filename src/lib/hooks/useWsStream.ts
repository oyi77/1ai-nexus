// ─────────────────────────────────────────────────────────────
// useWsStream — Generic Socket.IO hook for real-time data
// Connects to nexus-ws Socket.IO server through CF tunnel
// Auto-reconnect via socket.io-client built-in mechanism
// ─────────────────────────────────────────────────────────────

"use client"

import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'


interface WsMessage {
  [key: string]: unknown
}

const WS_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4401'
  : 'https://tracker-ws.aitradepulse.com'

// Crypto symbols that come from the WS server /prices namespace

type PriceTicker = { symbol: string; price?: string; change?: string }

const PRICES_TTL_MS = 5_000
let pricesCache: { at: number; tickers: PriceTicker[] } | null = null
let pricesInFlight: Promise<PriceTicker[]> | null = null

function loadPrices(): Promise<PriceTicker[]> {
  if (pricesCache && Date.now() - pricesCache.at < PRICES_TTL_MS) return Promise.resolve(pricesCache.tickers)
  if (pricesInFlight) return pricesInFlight
  pricesInFlight = fetch('/api/v1/market/prices')
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => {
      const tickers = d?.data?.tickers
      if (!Array.isArray(tickers)) return pricesCache?.tickers ?? []
      pricesCache = { at: Date.now(), tickers }
      return tickers as PriceTicker[]
    })
    .catch(() => pricesCache?.tickers ?? [])
    .finally(() => { pricesInFlight = null })
  return pricesInFlight
}

const CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX', 'LINK', 'ARB', 'OP'])

/**
 * Connect to a Socket.IO namespace on the nexus-ws server.
 */
export function useWsStream<T extends WsMessage = WsMessage>(namespace: string, room?: string) {
  const [data, setData] = useState<T | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket: Socket = io(`${WS_URL}${namespace}`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 5000,
      reconnectionAttempts: Infinity,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      setError(null)
      if (room) socket.emit('join', room)
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    socket.on('connect_error', (err: Error) => {
      setError(err.message)
    })

    // Generic event listener — the server emits with specific event names
    // For /prices it's "price", for /orderbook it's "depth", etc.
    // Listen for all events and update data
    socket.onAny((eventName: string, payload: unknown) => {
      if (eventName === 'connect' || eventName === 'disconnect') return
      setData(payload as T)
    })

    return () => {
      if (room) socket.emit('leave', room)
      socket.disconnect()
    }
  }, [namespace, room])

  return { data, connected, error }
}

/**
 * Subscribe to price updates for a symbol.
 * Routes through WS server /prices namespace (crypto) or REST fallback (TradFi).
 */
export function useTicker(symbol: string) {
  const [price, setPrice] = useState<number>(0)
  const [change, setChange] = useState<number>(0)
  const [volume, setVolume] = useState<number>(0)
  const [high24h, setHigh24h] = useState<number>(0)
  const [low24h, setLow24h] = useState<number>(0)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let restInterval: ReturnType<typeof setInterval> | null = null
    let socket: Socket | null = null
    let wsFailed = false

    const fetchFromRest = async () => {
      const tickers = await loadPrices()
      const ticker = tickers.find((t) => t.symbol === symbol)
      if (!ticker) return
      const parsedPrice = parseFloat(String(ticker.price ?? '').replace(/[$,]/g, ''))
      if (!isNaN(parsedPrice)) setPrice(parsedPrice)
      const parsedChange = parseFloat(String(ticker.change ?? '').replace(/[+%]/g, ''))
      if (!isNaN(parsedChange)) setChange(parsedChange)
      setConnected(true)
    }

    const isCrypto = CRYPTO_SYMBOLS.has(symbol)

    if (isCrypto) {
      // Try Socket.IO first for crypto, fallback to REST
      try {
        socket = io(`${WS_URL}/prices`, {
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 5000,
          reconnectionAttempts: Infinity,
        })

        const wsTimeout = setTimeout(() => {
          if (!socket?.connected) {
            wsFailed = true
            socket?.disconnect()
            fetchFromRest()
            restInterval = setInterval(fetchFromRest, 15_000)
          }
        }, 5_000)

        socket.on('connect', () => {
          clearTimeout(wsTimeout)
          setConnected(true)
          wsFailed = false
        })

        socket.on('price', (d: { symbol?: string; price?: number; change24h?: number; volume24h?: number; high24h?: number; low24h?: number }) => {
          if (d.symbol === symbol.toLowerCase()) {
            setPrice(d.price ?? 0)
            setChange(d.change24h ?? 0)
            setVolume(d.volume24h ?? 0)
            setHigh24h(d.high24h ?? 0)
            setLow24h(d.low24h ?? 0)
          }
        })

        socket.on('connect_error', () => {
          clearTimeout(wsTimeout)
          if (!wsFailed) {
            wsFailed = true
            fetchFromRest()
            restInterval = setInterval(fetchFromRest, 15_000)
          }
        })

        socket.on('disconnect', () => {
          if (!wsFailed) {
            setConnected(false)
          }
        })
      } catch {
        fetchFromRest()
        restInterval = setInterval(fetchFromRest, 15_000)
      }
    } else {
      // TradFi: REST only
      fetchFromRest()
      restInterval = setInterval(fetchFromRest, 30_000)
    }

    return () => {
      socket?.disconnect()
      if (restInterval) clearInterval(restInterval)
    }
  }, [symbol])

  return { price, change, volume, high24h, low24h, connected }
}
