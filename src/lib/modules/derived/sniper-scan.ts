// ─────────────────────────────────────────────────────────────
// Sniper scan — barrel facade.
// Split for the 800-line gate. All 16 consumers keep importing
// from '@/lib/modules/derived/sniper-scan' unchanged.
// ─────────────────────────────────────────────────────────────

export * from './sniper-scan-seen'
export * from './sniper-scan-discover'
export * from './sniper-scan-core'
