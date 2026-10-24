/**
 * Pure deterministic navigation matcher engine.
 * Solves active-state precision, query parameter specificity, and prefix collisions.
 */

function normalizePath(p: string): string {
  if (!p) return '/'
  if (p.length > 1 && p.endsWith('/')) {
    return p.slice(0, -1)
  }
  return p
}

function parseSearchParams(params?: string | URLSearchParams | null): URLSearchParams {
  if (!params) return new URLSearchParams()
  if (params instanceof URLSearchParams) return params
  if (typeof params === 'string') {
    const clean = params.startsWith('?') ? params.slice(1) : params
    return new URLSearchParams(clean)
  }
  return new URLSearchParams()
}

export function getActiveNavHref(
  allHrefs: string[],
  pathname: string,
  searchParams?: string | URLSearchParams | null,
): string | null {
  const normCurrentPath = normalizePath(pathname)
  const currentQuery = parseSearchParams(searchParams)
  const currentQueryCount = Array.from(currentQuery.keys()).length

  let bestHref: string | null = null
  let bestScore = -1
  let bestLength = -1

  for (const candidateHref of allHrefs) {
    const qIndex = candidateHref.indexOf('?')
    const rawCandidatePath = qIndex >= 0 ? candidateHref.slice(0, qIndex) : candidateHref
    const candidateQueryStr = qIndex >= 0 ? candidateHref.slice(qIndex + 1) : ''
    const candidatePath = normalizePath(rawCandidatePath)
    const candidateQuery = new URLSearchParams(candidateQueryStr)
    const candidateQueryKeys = Array.from(candidateQuery.keys())
    const candidateHasQuery = candidateQueryKeys.length > 0

    let score = -1

    if (candidatePath === normCurrentPath) {
      if (candidateHasQuery) {
        let allMatch = true
        for (const [key, val] of candidateQuery.entries()) {
          if (currentQuery.get(key) !== val) {
            allMatch = false
            break
          }
        }
        if (allMatch) {
          score = 3000 + candidateQueryKeys.length * 100 + candidateHref.length
        } else {
          score = -1
        }
      } else {
        if (currentQueryCount === 0) {
          score = 1500 + candidatePath.length
        } else {
          score = 1000 + candidatePath.length
        }
      }
    } else if (candidatePath !== '/' && normCurrentPath.startsWith(candidatePath + '/')) {
      if (candidateHasQuery) {
        score = -1
      } else {
        score = candidatePath.length
      }
    }

    if (score > 0) {
      if (score > bestScore) {
        bestScore = score
        bestLength = candidateHref.length
        bestHref = candidateHref
      } else if (score === bestScore && candidateHref.length > bestLength) {
        bestLength = candidateHref.length
        bestHref = candidateHref
      }
    }
  }

  return bestHref
}
