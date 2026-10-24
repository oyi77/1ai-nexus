export { default as gdelt } from './gdelt'
export { default as rssEngine } from './rss'
export { default as redditCrypto } from './reddit'
export { default as benzingaRe } from './benzinga'
export { default as cryptopanicRe } from './cryptopanic'
export { default as vimeroFeed } from './vimero'
export { default as defillamaResearch } from './defillama'

export type { FeedCategory, RssItem } from './rss'
export { FEEDS } from './rss'

export {
  fetchNewsIntelligence,
  persistNewsEvents,
  ingestRssFeeds,
  extractAssetEntities,
  classifySentimentDirection,
} from './news-intel'
export type { NewsEvent, ExchangeStatus } from './news-intel'
export type { ParsedFeedArticle, IngestOptions, IngestResult } from './rss-ingest'
