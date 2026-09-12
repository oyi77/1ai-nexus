// ─────────────────────────────────────────────────────────────
// RSS Engine Parser Tests
//
// These import the real parser. An earlier version of this file
// re-implemented extractTag/extractLink/cleanHtml locally, so the suite could
// stay green while production shipped two defects:
//   1. cleanHtml stripped tags BEFORE decoding entities, so feeds that
//      entity-encode their markup (e.g. ESMA) rendered raw HTML as article text.
//   2. parseRssItems only matched a literal `<item>`, so Atom <entry> feeds
//      (blockworks, the verge) returned zero items no matter how healthy.
// Assertions here run against engine.ts itself so a drift cannot hide again.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { cleanHtml, parseRssItems } from '../news/rss/engine'

describe('RSS Engine Parser', () => {
  describe('cleanHtml()', () => {
    it('strips plain HTML tags', () => {
      expect(cleanHtml('<p>Hello <b>World</b></p>')).toBe('Hello World')
    })

    it('decodes HTML entities', () => {
      expect(cleanHtml('Price: $5 &amp; up')).toBe('Price: $5 & up')
      expect(cleanHtml('1 &lt; 2')).toBe('1 < 2')
      expect(cleanHtml('2 &gt; 1')).toBe('2 > 1')
    })

    it('decodes numeric entities', () => {
      expect(cleanHtml('caf&#233; &amp; bar')).toBe('café & bar')
      expect(cleanHtml('&#x2014; dash')).toBe('\u2014 dash')
    })

    // Regression: entity-encoded markup must not survive as visible text.
    it('strips markup that arrives entity-encoded', () => {
      const raw = '&lt;span class="field field--name-title"&gt;Real headline&lt;/span&gt;'
      const out = cleanHtml(raw)
      expect(out).toBe('Real headline')
      expect(out).not.toMatch(/<[a-z/][^>]*>/i)
      expect(out).not.toContain('field--name-title')
    })

    it('collapses double-encoded markup too', () => {
      const out = cleanHtml('&amp;lt;b&amp;gt;Bold&amp;lt;/b&amp;gt; text')
      expect(out).not.toMatch(/<[a-z/][^>]*>/i)
      expect(out).toContain('Bold')
      expect(out).toContain('text')
    })

    it('trims and collapses whitespace', () => {
      expect(cleanHtml('  hello  ')).toBe('hello')
      expect(cleanHtml('a\n\n  b')).toBe('a b')
    })
  })

  describe('parseRssItems()', () => {
    it('parses RSS 2.0 items', () => {
      const xml = `
        <rss><channel>
          <item>
            <title>Bitcoin hits $100K</title>
            <link>https://example.com/btc</link>
            <pubDate>Thu, 19 Jun 2026 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Ethereum upgrade live</title>
            <link>https://example.com/eth</link>
          </item>
        </channel></rss>
      `
      const items = parseRssItems(xml, 'test-source', 'crypto')
      expect(items).toHaveLength(2)
      expect(items[0].title).toBe('Bitcoin hits $100K')
      expect(items[0].link).toBe('https://example.com/btc')
      expect(items[0].source).toBe('test-source')
      expect(items[1].title).toBe('Ethereum upgrade live')
    })

    it('parses items carrying attributes (RDF style)', () => {
      const xml = `<rdf:RDF><item rdf:about="https://example.com/a">
        <title>Attributed item</title>
        <link>https://example.com/a</link>
      </item></rdf:RDF>`
      const items = parseRssItems(xml, 'rdf-source', 'crypto')
      expect(items).toHaveLength(1)
      expect(items[0].title).toBe('Attributed item')
    })

    // Regression: Atom feeds previously produced zero items.
    it('parses Atom entries', () => {
      const xml = `
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>AI News</title>
            <link href="https://example.com/ai" />
            <published>2026-06-19T12:00:00Z</published>
            <summary>Short summary</summary>
          </entry>
        </feed>
      `
      const items = parseRssItems(xml, 'atom-source', 'tech')
      expect(items).toHaveLength(1)
      expect(items[0].title).toBe('AI News')
      expect(items[0].link).toBe('https://example.com/ai')
      expect(items[0].publishedAt).toBe('2026-06-19T12:00:00.000Z')
      expect(items[0].summary).toBe('Short summary')
    })

    it('prefers the alternate link over self/replies on Atom entries', () => {
      const xml = `<feed><entry>
        <title>Linked</title>
        <link rel="replies" href="https://example.com/comments" />
        <link rel="alternate" href="https://example.com/article" />
      </entry></feed>`
      const items = parseRssItems(xml, 'atom-source', 'tech')
      expect(items[0].link).toBe('https://example.com/article')
    })

    it('falls back to <updated> when <published> is absent', () => {
      const xml = `<feed><entry>
        <title>Updated only</title>
        <link rel="alternate" href="https://example.com/u" />
        <updated>2026-06-20T08:30:00Z</updated>
      </entry></feed>`
      const items = parseRssItems(xml, 'atom-source', 'tech')
      expect(items[0].publishedAt).toBe('2026-06-20T08:30:00.000Z')
    })

    it('cleans entity-encoded markup out of titles and summaries', () => {
      const xml = `<item>
        <title>Plain &amp; simple</title>
        <link>https://example.com/x</link>
        <description>&lt;span class="x"&gt;Encoded body&lt;/span&gt;</description>
      </item>`
      const items = parseRssItems(xml, 's', 'crypto')
      expect(items[0].title).toBe('Plain & simple')
      expect(items[0].summary).not.toMatch(/<[a-z/][^>]*>/i)
      expect(items[0].summary).toContain('Encoded body')
    })

    it('skips entries without a title', () => {
      const xml = `<item><link>https://example.com/no-title</link></item>`
      expect(parseRssItems(xml, 's', 'crypto')).toHaveLength(0)
    })

    it('returns an empty array for non-feed payloads', () => {
      expect(parseRssItems('<html><body>nothing</body></html>', 's', 'crypto')).toHaveLength(0)
    })
  })
})
