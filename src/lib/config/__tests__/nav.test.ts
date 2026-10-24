import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { NAV_SECTIONS, NAV_TOP_LEVEL } from '../nav'

describe('navigation information architecture', () => {
  const hrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href))
  const allHrefs = [...hrefs, ...NAV_SECTIONS.map((s) => s.href)]

  it('caps the sidebar at eight groups so the menu stays scannable', () => {
    expect(NAV_SECTIONS.length).toBeLessThanOrEqual(8)
  })

  it('gives every group a landing route', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.href.startsWith('/'), `${section.title} needs a route`).toBe(true)
    }
  })

  it('links every entry to a page that exists on disk', () => {
    const missing = allHrefs.filter((href) => {
      const path = href.split('?')[0]
      return path === '/' ? !existsSync('src/app/page.tsx') : !existsSync(`src/app${path}/page.tsx`)
    })
    expect(missing).toEqual([])
  })

  it('never links the same route twice', () => {
    const seen = new Set<string>()
    const duplicates = hrefs.filter((href) => (seen.has(href) ? true : (seen.add(href), false)))
    expect(duplicates).toEqual([])
  })

  it('uses unique labels inside a group so search results are unambiguous', () => {
    for (const section of NAV_SECTIONS) {
      const labels = section.items.map((i) => i.label)
      expect(new Set(labels).size, `${section.title} has a duplicate label`).toBe(labels.length)
    }
  })

  it('exposes one top-level entry per group for the mobile drawer', () => {
    expect(NAV_TOP_LEVEL).toHaveLength(NAV_SECTIONS.length)
    expect(NAV_TOP_LEVEL.map((t) => t.href)).toEqual(NAV_SECTIONS.map((s) => s.href))
  })

  it('defines exactly 14 primary essential items for simple mode', () => {
    const primaryItems = hrefs.filter((href) => {
      return NAV_SECTIONS.some((s) => s.items.some((i) => i.href === href && i.isPrimary))
    })
    expect(primaryItems).toHaveLength(14)
  })

  it('categorizes Markets and On-Chain items into visual sub-groups', () => {
    const markets = NAV_SECTIONS.find((s) => s.title === 'Markets')
    expect(markets).toBeDefined()
    const marketsCats = Array.from(new Set(markets?.items.map((i) => i.category).filter(Boolean)))
    expect(marketsCats).toEqual([
      'Core & Screeners',
      'Indonesian & Equities',
      'Crypto & Tokens',
      'TradFi & Derivatives',
    ])

    const onchain = NAV_SECTIONS.find((s) => s.title === 'On-Chain')
    expect(onchain).toBeDefined()
    const onchainCats = Array.from(new Set(onchain?.items.map((i) => i.category).filter(Boolean)))
    expect(onchainCats).toEqual([
      'Whales & Smart Money',
      'DEX Radar & Scanners',
      'DeFi & Yields',
      'Ecosystem & Macro',
    ])
  })
})
