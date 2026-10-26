import { describe, expect, it } from 'vitest';
import { splitTelegramHtml } from '../html-text';

function expectValid(chunks: string[], limit: number): void {
  expect(chunks.length).toBeGreaterThan(0);
  for (const chunk of chunks) {
    expect(chunk.length).toBeGreaterThan(0);
    expect(chunk.length).toBeLessThanOrEqual(limit);
    expect(chunk).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(chunk).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  }
}

describe('splitTelegramHtml', () => {
  it('returns short input unchanged and preserves empty input', () => {
    expect(splitTelegramHtml('<b>short &amp; sweet</b>')).toEqual(['<b>short &amp; sweet</b>']);
    expect(splitTelegramHtml('')).toEqual(['']);
  });

  it('rejects invalid limits', () => {
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => splitTelegramHtml('text', limit)).toThrow(RangeError);
    }
  });

  it('splits long unbroken text without losing content', () => {
    const text = 'x'.repeat(9000);
    const chunks = splitTelegramHtml(text);
    expectValid(chunks, 4096);
    expect(chunks.join('')).toBe(text);
  });

  it('never cuts entities or UTF-16 surrogate pairs', () => {
    const source = 'a'.repeat(4094) + '&amp;' + '😀'.repeat(3000);
    const chunks = splitTelegramHtml(source);
    expectValid(chunks, 4096);
    expect(chunks.join('')).toBe(source);
    expect(chunks[0]).toBe('a'.repeat(4094));
    expect(chunks[1].startsWith('&amp;')).toBe(true);
  });

  it('preserves a bare < in plain text instead of treating it as a tag', () => {
    const chunks = splitTelegramHtml('a<b', 2);
    expectValid(chunks, 2);
    expect(chunks).toEqual(['a<', 'b']);
  });

  it('rejects markup whose reopen overhead cannot fit the limit', () => {
    expect(() => splitTelegramHtml('<b><i><u><s><code>x</code></s></u></i></b>', 5)).toThrow(RangeError);
  });

  it('closes and reopens nested formatting without changing source text', () => {
    const source = '<b>bold <i>both <a href="https://x.co">link</a></i></b>';
    const chunks = splitTelegramHtml(source, 48);
    expectValid(chunks, 48);
    expect(chunks).toEqual([
      '<b>bold <i>both </i></b>',
      '<b><i><a href="https://x.co">link</a></i></b>',
    ]);
    expect(chunks[0] + chunks[1]).toBe(source.replace('<a href', '</i></b><b><i><a href'));
  });

  it('snapshots the tag stack at the newline it breaks on', () => {
    const chunks = splitTelegramHtml('<b>a\n<i>b</i></b>', 15);
    expectValid(chunks, 15);
    expect(chunks).toEqual(['<b>a\n</b>', '<b><i>b</i></b>']);
  });

  it('prefers newlines when they fit', () => {
    const chunks = splitTelegramHtml('first line\nsecond line\nthird line', 22);
    expectValid(chunks, 22);
    expect(chunks).toEqual(['first line\n', 'second line\n', 'third line']);
    expect(chunks.join('')).toBe('first line\nsecond line\nthird line');
  });

  it('keeps pre and code markup balanced across chunks', () => {
    const chunks = splitTelegramHtml('<pre><code>' + 'const x = 1;\n'.repeat(1000) + '</code></pre>');
    expectValid(chunks, 4096);
    for (const chunk of chunks.slice(1)) expect(chunk.startsWith('<pre><code>')).toBe(true);
    for (const chunk of chunks.slice(0, -1)) expect(chunk.endsWith('</code></pre>')).toBe(true);
  });

  it('handles exact limits and a small custom limit', () => {
    expect(splitTelegramHtml('12345', 5)).toEqual(['12345']);
    expect(splitTelegramHtml('123456', 5)).toEqual(['12345', '6']);
  });
});
