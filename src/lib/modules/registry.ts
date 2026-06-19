// ─────────────────────────────────────────────────────────────
// NEXUS Module Registry
// Auto-discovers all modules, orchestrates fetches, manages health
// ─────────────────────────────────────────────────────────────

import type { DataModule, DataCategory, FetchParams, ModuleResult } from './types'
import { recordSuccess, recordFailure, getAllHealth } from './health'

class ModuleRegistry {
  private modules = new Map<string, DataModule>()

  register(module: DataModule) {
    this.modules.set(module.id, module)
  }

  registerAll(modules: DataModule[]) {
    for (const m of modules) this.register(m)
  }

  get(id: string): DataModule | undefined {
    return this.modules.get(id)
  }

  getAll(): DataModule[] {
    return Array.from(this.modules.values())
  }

  getEnabled(category?: DataCategory): DataModule[] {
    const all = Array.from(this.modules.values())
    return category
      ? all.filter(m => m.isEnabled() && m.category === category)
      : all.filter(m => m.isEnabled())
  }

  getByCategory(category: DataCategory): DataModule[] {
    return Array.from(this.modules.values()).filter(m => m.category === category)
  }

  getModuleStatus() {
    const healthEntries = getAllHealth()
    const healthMap = new Map(healthEntries.map(h => [h.moduleId, h]))

    return Array.from(this.modules.values()).map(m => {
      const health = healthMap.get(m.id)
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        sourceType: m.sourceType,
        provenance: m.provenance,
        status: health?.status ?? 'active',
        lastChecked: health?.lastChecked,
        lastSuccess: health?.lastSuccess,
        failureCount: health?.failureCount ?? 0,
        notes: health?.notes,
      }
    })
  }

  async fetchOne<T = unknown>(moduleId: string, params: FetchParams = {}): Promise<ModuleResult<T>> {
    const mod = this.modules.get(moduleId)
    if (!mod) throw new Error(`Module not found: ${moduleId}`)
    if (!mod.isEnabled()) throw new Error(`Module disabled: ${moduleId}`)

    try {
      const result = await mod.fetch<T>(params)
      recordSuccess(mod)
      return result
    } catch (err) {
      recordFailure(mod, err)
      if (mod.fallbackFn) {
        try {
          const fallbackResult = await mod.fallbackFn<T>(params)
          return { ...fallbackResult, source: `${fallbackResult.source} (fallback)` }
        } catch {
          throw err
        }
      }
      throw err
    }
  }

  async fetchAll<T = unknown>(category: DataCategory, params: FetchParams = {}): Promise<ModuleResult<T>[]> {
    const modules = this.getEnabled(category)
    const results = await Promise.allSettled(
      modules.map(m => this.fetchOne<T>(m.id, params))
    )
    return results
      .filter((r): r is PromiseFulfilledResult<ModuleResult<T>> => r.status === 'fulfilled')
      .map(r => r.value)
  }
}

// Singleton
let registry: ModuleRegistry | undefined

export function getRegistry(): ModuleRegistry {
  if (!registry) {
    registry = new ModuleRegistry()
  }
  return registry
}

export { ModuleRegistry }
