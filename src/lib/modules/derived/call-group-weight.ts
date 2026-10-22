const UNSCORED_GROUP_WEIGHT = 0.25

function normalizeGroup(name: string): string {
  return name.trim().replace(/^@/, '').toLowerCase()
}

function weightOf(weights: Record<string, number>, group: string): number | null {
  const key = normalizeGroup(group)
  for (const [name, w] of Object.entries(weights)) {
    if (normalizeGroup(name) === key && Number.isFinite(w)) return w
  }
  return null
}

export function independentGroupCount(groups: readonly string[], weights: Record<string, number>): number {
  const seen = new Set<string>()
  let sum = 0
  for (const raw of groups) {
    if (typeof raw !== 'string' || raw.length === 0) continue
    const key = normalizeGroup(raw)
    if (seen.has(key)) continue
    seen.add(key)
    sum += Math.max(0, Math.min(1, weightOf(weights, raw) ?? UNSCORED_GROUP_WEIGHT))
  }
  return Math.round(sum * 100) / 100
}
