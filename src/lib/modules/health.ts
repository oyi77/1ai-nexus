// ─────────────────────────────────────────────────────────────
// Module Health Check Aggregator
// Tracks status of all registered modules, circuit-breaker integration
// ─────────────────────────────────────────────────────────────

import type { DataModule, ModuleStatus } from './types'

interface HealthEntry {
  moduleId: string
  sourceType: string
  status: ModuleStatus
  lastChecked: Date
  lastSuccess?: Date
  failureCount: number
  notes?: string
}

const healthMap = new Map<string, HealthEntry>()

const CIRCUIT_BREAK_THRESHOLD = 3

export function recordSuccess(module: DataModule) {
  healthMap.set(module.id, {
    moduleId: module.id,
    sourceType: module.sourceType,
    status: 'active',
    lastChecked: new Date(),
    lastSuccess: new Date(),
    failureCount: 0,
  })
}

export function recordFailure(module: DataModule, _error: unknown) {
  const existing = healthMap.get(module.id)
  const failureCount = (existing?.failureCount ?? 0) + 1
  const status: ModuleStatus = failureCount >= CIRCUIT_BREAK_THRESHOLD ? 'degraded' : 'active'
  const notes = module.sourceType === 're' && failureCount >= CIRCUIT_BREAK_THRESHOLD
    ? 'RE source change suspected'
    : undefined

  healthMap.set(module.id, {
    moduleId: module.id,
    sourceType: module.sourceType,
    status,
    lastChecked: new Date(),
    lastSuccess: existing?.lastSuccess,
    failureCount,
    notes,
  })
}

export function getModuleHealth(moduleId: string): HealthEntry | undefined {
  return healthMap.get(moduleId)
}

export function getAllHealth(): HealthEntry[] {
  return Array.from(healthMap.values())
}

export function isModuleDegraded(moduleId: string): boolean {
  return healthMap.get(moduleId)?.status === 'degraded'
}

export function resetHealth(moduleId: string) {
  healthMap.delete(moduleId)
}
