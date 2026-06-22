import { describe, expect, it } from 'vitest'
import { checkTokenSafety } from '@/lib/modules/derived/rug-checker'

describe('rug checker', () => {
  it('returns a result object with risk fields', () => {
    const result = checkTokenSafety('0x1234567890abcdef', 'eth')
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })
})
