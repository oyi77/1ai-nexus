import type { MetadataRoute } from 'next'

const BASE = 'https://tracker.aitradepulse.com'

// Sale-facing + crawler-valuable routes only. App shell pages (100+)
// are client-rendered behind auth or data-gated; listing them all would
// lie to crawlers about indexable content.
const STATIC_ROUTES = [
  '',
  '/pricing',
  '/terms',
  '/privacy',
  '/api-docs',
  '/login',
  '/signup',
  '/dashboard',
  '/ai-insights',
  '/moonshot',
  '/saham-ideas',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return STATIC_ROUTES.map((path) => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: path === '' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : path === '/pricing' ? 0.9 : 0.7,
  }))
}
