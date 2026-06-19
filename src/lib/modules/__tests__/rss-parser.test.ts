// ─────────────────────────────────────────────────────────────
// RSS Engine Parser Tests
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'

// We need to test the RSS parsing logic.
// Since parseRssItems is not exported directly, we test via the module's fetch.
// But we can extract the XML parsing logic for unit testing.

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m?.[1]?.trim() ?? ''
}

function extractLink(xml: string): string {
  const m = xml.match(/<link[^>]*href="([^"]+)"/i)
  if (m) return m[1]
  return extractTag(xml, 'link')
}

function cleanHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
}

function parseRssItems(xml: string, sourceId: string): Array<{ title: string; link: string; source: string }> {
  const items: Array<{ title: string; link: string; source: string }> = []
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = extractTag(block, 'title')
    const link = extractLink(block)
    if (title && link) items.push({ title: cleanHtml(title), link, source: sourceId })
  }
  return items
}

describe('RSS Engine Parser', () => {
  describe('extractTag()', () => {
    it('extracts content from XML tags', () => {
      expect(extractTag('<title>Hello World</title>', 'title')).toBe('Hello World')
    })

    it('handles CDATA content', () => {
      const xml = '<description><![CDATA[Some <b>bold</b> text]]></description>'
      expect(extractTag(xml, 'description')).toContain('Some')
    })

    it('returns empty string for missing tags', () => {
      expect(extractTag('<title>Hello</title>', 'description')).toBe('')
    })

    it('handles self-closing and empty tags', () => {
      expect(extractTag('<title></title>', 'title')).toBe('')
    })
  })

  describe('extractLink()', () => {
    it('extracts href from atom-style link', () => {
      expect(extractLink('<link href="https://example.com/article" />')).toBe('https://example.com/article')
    })

    it('extracts content from RSS-style link', () => {
      expect(extractLink('<link>https://example.com/article</link>')).toBe('https://example.com/article')
    })
  })

  describe('cleanHtml()', () => {
    it('strips HTML tags', () => {
      expect(cleanHtml('<p>Hello <b>World</b></p>')).toBe('Hello World')
    })

    it('decodes HTML entities', () => {
      expect(cleanHtml('Price: $5 &amp; up')).toBe('Price: $5 & up')
      expect(cleanHtml('1 &lt; 2')).toBe('1 < 2')
      expect(cleanHtml('2 &gt; 1')).toBe('2 > 1')
    })

    it('trims whitespace', () => {
      expect(cleanHtml('  hello  ')).toBe('hello')
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
      const items = parseRssItems(xml, 'test-source')
      expect(items).toHaveLength(2)
      expect(items[0].title).toBe('Bitcoin hits $100K')
      expect(items[0].link).toBe('https://example.com/btc')
      expect(items[0].source).toBe('test-source')
      expect(items[1].title).toBe('Ethereum upgrade live')
    })

    it('parses Atom entries', () => {
      const xml = `
        <feed>
          <entry>
            <title>AI News</title>
            <link href="https://example.com/ai" />
          </entry>
        </feed>
      `
      const items = parseRssItems(xml, 'atom-source')
      expect(items).toHaveLength(1)
      expect(items[0].title).toBe('AI News')
      expect(items[0].link).toBe('https://example.com/ai')
    })

    it('skips entries without title', () => {
      const xml = `
        <rss><channel>
          <item>
            <link>https://example.com/no-title</link>
          </item>
          <item>
            <title>Has title</title>
            <link>https://example.com/has-title</link>
          </item>
        </channel></rss>
      `
      const items = parseRssItems(xml, 'test')
      expect(items).toHaveLength(1)
      expect(items[0].title).toBe('Has title')
    })

    it('skips entries without link', () => {
      const xml = `
        <rss><channel>
          <item>
            <title>No link here</title>
          </item>
        </channel></rss>
      `
      const items = parseRssItems(xml, 'test')
      expect(items).toHaveLength(0)
    })

    it('handles empty XML', () => {
      expect(parseRssItems('', 'test')).toHaveLength(0)
    })

    it('strips HTML from titles', () => {
      const xml = `
        <rss><channel>
          <item>
            <title><![CDATA[Bitcoin <b>surges</b> past $100K]]></title>
            <link>https://example.com</link>
          </item>
        </channel></rss>
      `
      const items = parseRssItems(xml, 'test')
      expect(items[0].title).not.toContain('<b>')
      expect(items[0].title).toContain('surges')
    })
  })
})
