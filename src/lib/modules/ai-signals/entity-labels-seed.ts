// ─────────────────────────────────────────────────────────────
// Entity Label Service — DB-backed queries
// Replaces hardcoded seed data with Prisma entity + wallet tables
// ─────────────────────────────────────────────────────────────

import { prisma } from '@/lib/db'

export interface EntitySeed {
  address: string
  chain: string
  label: string
  category: string
  confidence: number
}

let cachedSeeds: EntitySeed[] | null = null

async function loadSeeds(): Promise<EntitySeed[]> {
  if (cachedSeeds) return cachedSeeds
  const entities = await prisma.entity.findMany({
    include: { wallets: { select: { address: true, chain: true } } },
  })
  cachedSeeds = []
  for (const e of entities) {
    for (const w of e.wallets) {
      cachedSeeds.push({
        address: w.address,
        chain: w.chain || 'eth',
        label: e.name,
        category: e.type,
        confidence: e.verified ? 0.9 : 0.7,
      })
    }
  }
  return cachedSeeds
}

/** Get entity label for an address */
export async function getEntityLabel(address: string, chain: string = 'eth'): Promise<EntitySeed | undefined> {
  const seeds = await loadSeeds()
  const normalized = address.toLowerCase()
  return seeds.find(e => e.address.toLowerCase() === normalized && e.chain === chain)
}

/** Get all entities by category */
export async function getEntitiesByCategory(category: string): Promise<EntitySeed[]> {
  const seeds = await loadSeeds()
  return seeds.filter(e => e.category === category)
}

/** Get all entity seeds (for backward compatibility with callers that need the full array) */
export async function getEntitySeeds(): Promise<EntitySeed[]> {
  return loadSeeds()
}

/** Clear the in-memory cache (useful after DB updates) */
export function invalidateEntityCache(): void {
  cachedSeeds = null
}
