import { describe, it, expect } from 'vitest'
import {
  extractAssetEntities,
  classifySentimentDirection,
} from '../rss-ingest'

describe('RSS Ingest Engine', () => {
  describe('extractAssetEntities', () => {
    it('extracts crypto assets from text', () => {
      const text = 'Bitcoin and Ethereum rally while Solana and Dogecoin hit new records'
      const entities = extractAssetEntities(text)
      expect(entities).toContain('BTC')
      expect(entities).toContain('ETH')
      expect(entities).toContain('SOL')
      expect(entities).toContain('DOGE')
    })

    it('extracts Indonesian equities from text', () => {
      const text = 'Saham BBCA dan Bank Rakyat Indonesia (BBRI) menguat, IHSG dekati level 7.800'
      const entities = extractAssetEntities(text)
      expect(entities).toContain('BBCA')
      expect(entities).toContain('BBRI')
      expect(entities).toContain('IHSG')
    })

    it('extracts Astra and Telkom correctly', () => {
      const text = 'Astra International (ASII) dan Telkom Indonesia (TLKM) catat kinerja positif'
      const entities = extractAssetEntities(text)
      expect(entities).toContain('ASII')
      expect(entities).toContain('TLKM')
    })

    it('extracts TradFi and commodity assets', () => {
      const text = 'Nvidia (NVDA) and Apple (AAPL) lift Nasdaq (QQQ) as Crude Oil prices drop'
      const entities = extractAssetEntities(text)
      expect(entities).toContain('NVDA')
      expect(entities).toContain('AAPL')
      expect(entities).toContain('QQQ')
      expect(entities).toContain('OIL')
    })

    it('returns empty array when text has no known entities or is empty', () => {
      expect(extractAssetEntities('')).toEqual([])
      expect(extractAssetEntities('General weather report for tomorrow')).toEqual([])
    })

    it('deduplicates entity symbols', () => {
      const text = 'Bitcoin BTC bitcoin BTC rally'
      const entities = extractAssetEntities(text)
      expect(entities).toEqual(['BTC'])
    })
  })

  describe('classifySentimentDirection', () => {
    it('classifies bullish sentiment in English', () => {
      const text = 'Bitcoin surges to all-time high as ETF inflows break records'
      const result = classifySentimentDirection(text)
      expect(result.direction).toBe('bullish')
      expect(result.score).toBeGreaterThan(0)
    })

    it('classifies bearish sentiment in English', () => {
      const text = 'Crypto market crash triggers massive liquidations after major protocol exploit'
      const result = classifySentimentDirection(text)
      expect(result.direction).toBe('bearish')
      expect(result.score).toBeLessThan(0)
    })

    it('classifies bullish sentiment in Indonesian', () => {
      const text = 'Laba bersih BBCA melonjak pesat, dividen interim dibagikan'
      const result = classifySentimentDirection(text)
      expect(result.direction).toBe('bullish')
      expect(result.score).toBeGreaterThan(0)
    })

    it('classifies bearish sentiment in Indonesian', () => {
      const text = 'IHSG anjlok tertekan aksi jual masif, rupiah melemah tajam'
      const result = classifySentimentDirection(text)
      expect(result.direction).toBe('bearish')
      expect(result.score).toBeLessThan(0)
    })

    it('classifies neutral sentiment when balanced or without polarity keywords', () => {
      const text = 'Federal Reserve will convene on Wednesday for regular monetary meeting'
      const result = classifySentimentDirection(text)
      expect(result.direction).toBe('neutral')
      expect(result.score).toBe(0)
    })

    it('handles empty input safely', () => {
      const result = classifySentimentDirection('')
      expect(result.direction).toBe('neutral')
      expect(result.score).toBe(0)
    })
  })
})
