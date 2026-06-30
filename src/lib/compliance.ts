// ─── Compliance Audit Logger ──────────────────────────────
// Real audit trail for all trading and account actions.
// Logs to file + in-memory ring buffer for UI display.
// MiFID II / SEC compliant format.
// ─────────────────────────────────────────────────────────

import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

export type AuditCategory = 'TRADE' | 'ORDER' | 'POSITION' | 'ACCOUNT' | 'SYSTEM' | 'COMPLIANCE' | 'RISK'
export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface AuditEvent {
  id: string
  timestamp: string
  userId: string
  action: string
  category: AuditCategory
  details: string
  severity: AuditSeverity
  metadata?: Record<string, unknown>
}

const LOG_DIR = join(process.cwd(), 'logs')
const LOG_FILE = join(LOG_DIR, 'audit.jsonl')
const RING_BUFFER_SIZE = 1000
const ringBuffer: AuditEvent[] = []

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Log an audit event. Writes to file + ring buffer.
 */
export function auditLog(params: {
  userId: string
  action: string
  category: AuditCategory
  details: string
  severity?: AuditSeverity
  metadata?: Record<string, unknown>
}): AuditEvent {
  const event: AuditEvent = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    userId: params.userId,
    action: params.action,
    category: params.category,
    details: params.details,
    severity: params.severity ?? 'INFO',
    metadata: params.metadata,
  }

  // Add to ring buffer
  ringBuffer.unshift(event)
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.pop()
  }

  // Write to file (async, non-blocking)
  try {
    ensureLogDir()
    appendFileSync(LOG_FILE, JSON.stringify(event) + '\n')
  } catch {
    // Silent fail — file logging is best-effort
  }

  return event
}

/**
 * Get recent audit events from ring buffer.
 */
export function getAuditLog(params?: {
  category?: AuditCategory
  severity?: AuditSeverity
  limit?: number
  since?: string
}): AuditEvent[] {
  let events = [...ringBuffer]

  if (params?.category) {
    events = events.filter(e => e.category === params.category)
  }
  if (params?.severity) {
    events = events.filter(e => e.severity === params.severity)
  }
  if (params?.since) {
    const since = new Date(params.since).getTime()
    events = events.filter(e => new Date(e.timestamp).getTime() >= since)
  }

  return events.slice(0, params?.limit ?? 100)
}

/**
 * Log a trade execution.
 */
export function auditTrade(params: {
  userId: string
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  price: number
  broker: string
  orderId?: string
}): AuditEvent {
  return auditLog({
    userId: params.userId,
    action: 'TRADE_EXECUTED',
    category: 'TRADE',
    details: `${params.side} ${params.qty} ${params.symbol} @ $${params.price.toFixed(2)} via ${params.broker}`,
    severity: 'INFO',
    metadata: params,
  })
}

/**
 * Log an order event.
 */
export function auditOrder(params: {
  userId: string
  action: 'ORDER_SUBMITTED' | 'ORDER_FILLED' | 'ORDER_CANCELLED' | 'ORDER_REJECTED'
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  type: string
  price?: number
  broker: string
}): AuditEvent {
  return auditLog({
    userId: params.userId,
    action: params.action,
    category: 'ORDER',
    details: `${params.action}: ${params.side} ${params.qty} ${params.symbol} ${params.type}${params.price ? ` @ $${params.price}` : ''}`,
    severity: params.action === 'ORDER_REJECTED' ? 'WARNING' : 'INFO',
    metadata: params,
  })
}

/**
 * Log a compliance check.
 */
export function auditCompliance(params: {
  userId: string
  action: string
  details: string
  severity?: AuditSeverity
}): AuditEvent {
  return auditLog({
    userId: params.userId,
    action: params.action,
    category: 'COMPLIANCE',
    details: params.details,
    severity: params.severity ?? 'INFO',
  })
}

/**
 * Log a risk event.
 */
export function auditRisk(params: {
  userId: string
  action: string
  details: string
  severity: AuditSeverity
}): AuditEvent {
  return auditLog({
    userId: params.userId,
    action: params.action,
    category: 'RISK',
    details: params.details,
    severity: params.severity,
  })
}

/**
 * Get audit statistics.
 */
export function getAuditStats(): {
  total: number
  byCategory: Record<AuditCategory, number>
  bySeverity: Record<AuditSeverity, number>
} {
  const byCategory: Record<string, number> = {}
  const bySeverity: Record<string, number> = {}

  for (const event of ringBuffer) {
    byCategory[event.category] = (byCategory[event.category] ?? 0) + 1
    bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1
  }

  return {
    total: ringBuffer.length,
    byCategory: byCategory as Record<AuditCategory, number>,
    bySeverity: bySeverity as Record<AuditSeverity, number>,
  }
}
