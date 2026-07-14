// ─── Usage Tracking (in-memory, per-edge instance) ─────────

interface UsageEntry {
  totalCalls: number;
  lastCalledAt: number;
  endpoints: Record<string, number>;
}

const usageMap = new Map<string, UsageEntry>();

export function trackUsage(apiKey: string, pathname: string): void {
  const now = Date.now();
  let entry = usageMap.get(apiKey);

  if (!entry) {
    entry = { totalCalls: 0, lastCalledAt: now, endpoints: {} };
    usageMap.set(apiKey, entry);
  }

  entry.totalCalls++;
  entry.lastCalledAt = now;
  entry.endpoints[pathname] = (entry.endpoints[pathname] || 0) + 1;
}

/** Get usage stats for an API key (callable from API routes) */
export function getUsage(apiKey: string): UsageEntry | null {
  return usageMap.get(apiKey) ?? null;
}

export type { UsageEntry };
