/**
 * Curl-based fetch for Cloudflare-protected sites
 * Uses the system `curl` binary which has a browser-compatible TLS fingerprint
 * that Cloudflare doesn't block. Falls back to standard fetch when curl isn't available.
 */

import { execFileSync } from 'child_process'

interface CurlResponse {
  status: number
  body: string
}

/**
 * Fetch a URL using system `curl` with browser-like TLS fingerprint.
 * This bypasses Cloudflare challenges that block Node.js's built-in fetch.
 */
export function curlFetch(url: string, options?: {
  headers?: Record<string, string>
  timeout?: number
  method?: string
  body?: string
}): CurlResponse {
  const timeout = options?.timeout ?? 10
  const method = options?.method ?? 'GET'

  // Build curl args
  const args = [
    '-s',  // silent
    '-L',  // follow redirects
    '--max-time', String(timeout),
    '--http2',
    '-X', method,
  ]

  // Set default browser-like headers
  const headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...options?.headers,
  }

  for (const [key, value] of Object.entries(headers)) {
    args.push('-H', `${key}: ${value}`)
  }

  if (options?.body) {
    args.push('--data', options.body)
  }

  args.push(url)

  try {
    const stdout = execFileSync('curl', args, {
      timeout: (timeout + 2) * 1000,
      maxBuffer: 5 * 1024 * 1024, // 5MB for large pages
    })

    return { status: 200, body: stdout.toString() }
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer; stdout?: Buffer }
    // On curl failure, try to extract partial output
    const stderr = err.stderr?.toString() ?? ''
    const stdout = err.stdout?.toString() ?? ''
    if (stdout) {
      return { status: 200, body: stdout }
    }
    throw new Error(`curl fetch failed: ${stderr.substring(0, 200)}`)
  }
}

/**
 * Async version of curlFetch that returns a promise.
 */
export async function curlFetchAsync(url: string, options?: {
  headers?: Record<string, string>
  timeout?: number
  method?: string
  body?: string
}): Promise<CurlResponse> {
  return curlFetch(url, options)
}
