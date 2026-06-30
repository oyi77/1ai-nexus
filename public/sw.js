// NEXUS Service Worker — PWA + offline shell
const CACHE_NAME = 'nexus-v4'
const STATIC_ASSETS = [
  '/',
  '/dashboard',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512.svg',
]

// API endpoints to cache for offline
const CACHEABLE_API = [
  '/api/v1/health',
  '/api/v1/macro',
  '/api/v1/fear-greed',
]

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  )
})

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// Fetch: network-first for pages, cache-first for assets, stale-while-revalidate for API
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET and non-http(s) schemes (chrome-extension, etc.)
  if (request.method !== 'GET') return
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return

  // Static assets: cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(png|svg|ico|woff2?)$/)
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return response
        })
      })
    )
    return
  }

  // Cacheable API: stale-while-revalidate
  if (CACHEABLE_API.some(api => url.pathname.startsWith(api))) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return response
        }).catch(() => cached)

        return cached || fetchPromise
      })
    )
    return
  }

  // Pages: network-first, fallback to cache
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
        }
        return response
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('/')))
  )
})
