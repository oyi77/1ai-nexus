/**
 * API usage tracking utilities
 * Tracks API key usage statistics in-memory
 */

interface UsageEntry {
  totalCalls: number;
  lastCalledAt: Date;
  endpoints: Map<string, number>;
}

const usageMap = new Map<string, UsageEntry>();

/**
 * Track API usage for a given key and endpoint
 */
export function trackUsage(apiKey: string, endpoint: string): void {
  const existing = usageMap.get(apiKey);
  if (existing) {
    existing.totalCalls++;
    existing.lastCalledAt = new Date();
    existing.endpoints.set(endpoint, (existing.endpoints.get(endpoint) || 0) + 1);
  } else {
    const endpoints = new Map<string, number>();
    endpoints.set(endpoint, 1);
    usageMap.set(apiKey, {
      totalCalls: 1,
      lastCalledAt: new Date(),
      endpoints,
    });
  }
}

/**
 * Get usage statistics for a specific API key
 */
export function getUsage(apiKey: string) {
  const usage = usageMap.get(apiKey);
  if (!usage) {
    return null;
  }

  // Convert endpoints Map to array and sort by count
  const endpointArray = Array.from(usage.endpoints.entries())
    .map(([endpoint, count]) => ({ endpoint, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10

  return {
    totalCalls: usage.totalCalls,
    lastCalledAt: usage.lastCalledAt.toISOString(),
    endpoints: Object.fromEntries(usage.endpoints),
    topEndpoints: endpointArray,
  };
}
