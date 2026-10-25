// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { useLiveFetch } from './useLiveFetch'

type Payload = { value: number } | undefined
type Snapshot = { data: Payload; status: string; refresh: () => Promise<void> }

let latest: Snapshot
let container: HTMLDivElement
let root: Root

function Probe() {
  const snapshot = useLiveFetch<Payload>({ url: '/probe', interval: 60_000 })
  useEffect(() => { latest = snapshot }, [snapshot])
  return <span>{snapshot.status}</span>
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useLiveFetch error states', () => {
  it('treats an error envelope as an error instead of successful empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { data: null, error: 'upstream unavailable' })))

    await act(async () => root.render(<Probe />))
    expect(latest.status).toBe('error')
    expect(latest.data).toBeUndefined()
  })

  it('retains the last good payload and marks it stale after a refresh failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { data: { value: 7 }, error: null }))
      .mockResolvedValueOnce(response(502, { data: null, error: 'upstream unavailable' }))
    vi.stubGlobal('fetch', fetchMock)

    await act(async () => root.render(<Probe />))
    expect(latest.status).toBe('live')
    expect(latest.data).toEqual({ value: 7 })

    await act(async () => latest.refresh())

    expect(latest.status).toBe('stale')
    expect(latest.data).toEqual({ value: 7 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
