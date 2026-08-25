// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SortableTh, TableControlsBar, useTableControls, type TableControls } from './TableControls'

// React 19 requires this flag for act() to flush synchronously in test envs.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Row = { symbol: string; price: string } & Record<string, unknown>

const ROWS: Row[] = [
  { symbol: 'BTC', price: '$80,060' },
  { symbol: 'ETH', price: '$2,487' },
  { symbol: 'SOL', price: '$100.68' },
]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

function Harness({ rows }: { rows: Row[] }) {
  const tc = useTableControls<Row>(rows)
  return createElement('div', {},
    createElement(TableControlsBar, {
      idPrefix: 'test',
      query: tc.query,
      onQueryChange: tc.setQuery,
      shown: tc.visible.length,
      total: tc.total,
    }),
    createElement('table', {},
      createElement('thead', {}, createElement('tr', {},
        createElement(SortableTh, { controls: tc as TableControls<Record<string, unknown>>, k: 'symbol' }, 'SYMBOL'),
        createElement(SortableTh, { controls: tc as TableControls<Record<string, unknown>>, k: 'price' }, 'PRICE'),
      )),
      createElement('tbody', {},
        tc.visible.map(r => createElement('tr', { key: r.symbol }, createElement('td', {}, r.symbol), createElement('td', {}, r.price))),
      ),
    ),
    createElement('span', { 'data-testid': 'query' }, tc.query),
  )
}

async function setInput(value: string) {
  const input = host.querySelector('input[type="search"]') as HTMLInputElement
  // Use the native value setter so React's value tracker registers the change
  // and fires onChange; assigning .value directly is deduped by React.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function bodySymbols(): Array<string | null> {
  return [...host.querySelectorAll('tbody td:first-child')].map(td => td.textContent)
}

describe('TableControlsBar (jsdom)', () => {
  it('renders a labelled search input with live row-count badge', () => {
    act(() => { root.render(createElement(Harness, { rows: ROWS })) })
    const input = host.querySelector('input[type="search"]') as HTMLInputElement
    expect(input.id).toBe('test-filter')
    expect(host.querySelector('label[for="test-filter"]')).toBeTruthy()
    expect(host.querySelector('span[aria-live]')?.textContent).toBe('3/3 rows')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('filters rows and updates the badge as the user types', async () => {
    act(() => { root.render(createElement(Harness, { rows: ROWS })) })
    await setInput('btc')
    expect((host.querySelector('[data-testid="query"]') as HTMLElement).textContent).toBe('btc')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('1/3 rows')
    await setInput('zzz-nomatch')
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(host.querySelector('span[aria-live]')?.textContent).toBe('0/3 rows')
    expect(host.querySelector('input[type="search"]')).toBeTruthy()
  })
})

describe('SortableTh (jsdom)', () => {
  it('sorts formatted currency numerically on click and toggles direction', async () => {
    act(() => { root.render(createElement(Harness, { rows: ROWS })) })
    const priceTh = [...host.querySelectorAll('th')].find(th => th.textContent!.includes('PRICE'))!

    await act(async () => { priceTh.click() })
    expect(priceTh.getAttribute('aria-sort')).toBe('descending')
    // Numeric-aware: $80,060 > $2,487 > $100.68 (lexical would misorder).
    expect(bodySymbols()).toEqual(['BTC', 'ETH', 'SOL'])

    await act(async () => { priceTh.click() })
    expect(priceTh.getAttribute('aria-sort')).toBe('ascending')
    expect(bodySymbols()).toEqual(['SOL', 'ETH', 'BTC'])
  })

  it('is keyboard operable via Enter and Space', async () => {
    act(() => { root.render(createElement(Harness, { rows: ROWS })) })
    const symbolTh = host.querySelector('th') as HTMLElement
    expect(symbolTh.tabIndex).toBe(0)

    // First activation sorts a new column descending (SOL > ETH > BTC).
    await act(async () => {
      symbolTh.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(symbolTh.getAttribute('aria-sort')).toBe('descending')
    expect(bodySymbols()).toEqual(['SOL', 'ETH', 'BTC'])

    // Space flips direction to ascending.
    await act(async () => {
      symbolTh.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    expect(symbolTh.getAttribute('aria-sort')).toBe('ascending')
    expect(bodySymbols()).toEqual(['BTC', 'ETH', 'SOL'])
  })

  it('ignores non-activating keys', async () => {
    act(() => { root.render(createElement(Harness, { rows: ROWS })) })
    const symbolTh = host.querySelector('th') as HTMLElement
    await act(async () => {
      symbolTh.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(symbolTh.getAttribute('aria-sort')).toBeNull()
  })
})
