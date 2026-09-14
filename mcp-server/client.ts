// NEXUS MCP Server -- NEXUS API client + query helper.

import { NEXUS_API } from './types'

export async function callNexusApi(path: string): Promise<unknown> {
  const res = await fetch(`${NEXUS_API}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`NEXUS API ${res.status}: ${path}`)
  return res.json() as Promise<unknown>
}

export async function postNexusApi(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${NEXUS_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`NEXUS API ${res.status}: ${path}`)
  return res.json() as Promise<unknown>
}

export function qs(args: Record<string, unknown>, keys: string[]): string {
  const params = new URLSearchParams()
  for (const k of keys) {
    if (args[k] !== undefined && args[k] !== null) params.set(k, String(args[k]))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}
