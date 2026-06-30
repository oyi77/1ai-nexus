// ─────────────────────────────────────────────────────────────
// Alert Delivery System
// Supports: webhook with HMAC signing, console log
// SSRF protection: validates webhook URLs before delivery
// Persistence: PostgreSQL via Prisma (with in-memory cache)
// ─────────────────────────────────────────────────────────────

import { Prisma } from '@prisma/client'
import { deliverWebhook } from '@/lib/alerts/delivery'
import { prisma } from '@/lib/db'

export interface Alert {
  id: string
  templateId?: string
  name?: string
  condition?: string
  webhookUrl?: string
  webhookSecret?: string
  enabled: boolean
  lastFired?: number
  createdAt: number
  updatedAt?: number
  userId?: string
  triggerType?: string
  conditions?: Prisma.InputJsonValue
}

export interface AlertEvent {
  alertId: string
  alertName: string
  triggeredAt: number
  value: unknown
  message: string
}

const alerts = new Map<string, Alert>()
const alertLog: AlertEvent[] = []
const MAX_LOG = 1000

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
  /^localhost$/i,
]

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_RANGES.some((rx) => rx.test(hostname))
}

function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Only http/https URLs allowed' }
  }

  if (isPrivateHost(parsed.hostname)) {
    return { valid: false, error: 'Private/internal IP addresses are not allowed' }
  }

  return { valid: true }
}

function toDbDate(ts?: number): Date | undefined {
  if (typeof ts !== 'number') return undefined
  return new Date(ts)
}

function fromDbDate(date?: Date | null): number | undefined {
  if (!date) return undefined
  return date.getTime()
}

export async function createAlert(alert: Alert): Promise<Alert> {
  if (alert.webhookUrl) {
    const check = validateWebhookUrl(alert.webhookUrl)
    if (!check.valid) {
      throw new Error(`Invalid webhook URL: ${check.error}`)
    }
  }

  const dbAlert = await prisma.alert.create({
    data: {
      userId: alert.userId ?? 'default',
      triggerType: alert.triggerType ?? alert.condition ?? 'manual',
      conditions: (alert.conditions ?? {}) as Prisma.InputJsonValue,
      templateId: alert.templateId,
      name: alert.name,
      condition: alert.condition,
      webhookUrl: alert.webhookUrl,
      webhookSecret: alert.webhookSecret,
      isActive: alert.enabled,
      lastFired: toDbDate(alert.lastFired),
    },
  })

  const persisted: Alert = {
    ...alert,
    id: dbAlert.id,
    createdAt: dbAlert.createdAt.getTime(),
    updatedAt: dbAlert.updatedAt.getTime(),
    lastFired: fromDbDate(dbAlert.lastFired),
  }

  alerts.set(persisted.id, persisted)
  return persisted
}

export async function getAlerts(): Promise<Alert[]> {
  if (alerts.size === 0) {
    const dbAlerts = await prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
    })
    for (const dbAlert of dbAlerts) {
      const alert: Alert = {
        id: dbAlert.id,
        userId: dbAlert.userId ?? undefined,
        triggerType: dbAlert.triggerType ?? undefined,
        conditions: (dbAlert.conditions as Prisma.InputJsonValue) ?? {},
        templateId: dbAlert.templateId ?? undefined,
        name: dbAlert.name ?? undefined,
        condition: dbAlert.condition ?? undefined,
        webhookUrl: dbAlert.webhookUrl ?? undefined,
        webhookSecret: dbAlert.webhookSecret ?? undefined,
        enabled: dbAlert.isActive,
        lastFired: fromDbDate(dbAlert.lastFired),
        createdAt: dbAlert.createdAt.getTime(),
        updatedAt: dbAlert.updatedAt.getTime(),
      }
      alerts.set(alert.id, alert)
    }
  }

  return Array.from(alerts.values())
}

export async function deleteAlert(id: string): Promise<boolean> {
  const existing = alerts.get(id)
  const deleted = await prisma.alert.delete({ where: { id } }).then(() => true).catch(() => false)
  alerts.delete(id)
  return deleted || Boolean(existing)
}

export async function toggleAlert(id: string): Promise<Alert | undefined> {
  const cached = alerts.get(id)
  if (cached) cached.enabled = !cached.enabled

  const dbAlert = await prisma.alert.update({
    where: { id },
    data: { isActive: cached ? cached.enabled : true },
  })

  const updated: Alert = {
    ...(cached ?? {
      id: dbAlert.id,
      name: dbAlert.name ?? undefined,
      enabled: dbAlert.isActive,
      createdAt: dbAlert.createdAt.getTime(),
      userId: dbAlert.userId ?? undefined,
      triggerType: dbAlert.triggerType ?? undefined,
      conditions: (dbAlert.conditions as Prisma.InputJsonValue) ?? {},
    }),
    id: dbAlert.id,
    enabled: dbAlert.isActive,
    updatedAt: dbAlert.updatedAt.getTime(),
    lastFired: fromDbDate(dbAlert.lastFired),
  }

  alerts.set(updated.id, updated)
  return updated
}

export async function fireAlert(alertId: string, value: unknown, message: string): Promise<void> {
  let alert = alerts.get(alertId)

  if (!alert) {
    const dbAlert = await prisma.alert.findUnique({ where: { id: alertId } }).catch(() => null)
    if (dbAlert) {
      alert = {
        id: dbAlert.id,
        userId: dbAlert.userId ?? undefined,
        triggerType: dbAlert.triggerType ?? undefined,
        conditions: (dbAlert.conditions as Prisma.InputJsonValue) ?? {},
        templateId: dbAlert.templateId ?? undefined,
        name: dbAlert.name ?? undefined,
        condition: dbAlert.condition ?? undefined,
        webhookUrl: dbAlert.webhookUrl ?? undefined,
        webhookSecret: dbAlert.webhookSecret ?? undefined,
        enabled: dbAlert.isActive,
        lastFired: fromDbDate(dbAlert.lastFired),
        createdAt: dbAlert.createdAt.getTime(),
        updatedAt: dbAlert.updatedAt.getTime(),
      }
      alerts.set(alertId, alert)
    }
  }

  if (!alert || !alert.enabled) return

  const event: AlertEvent = {
    alertId,
    alertName: alert.name ?? 'Unnamed alert',
    triggeredAt: Date.now(),
    value,
    message,
  }

  alertLog.push(event)
  if (alertLog.length > MAX_LOG) alertLog.shift()

  const now = new Date()
  await prisma.alert.update({
    where: { id: alertId },
    data: { lastFired: now, updatedAt: now },
  }).catch(() => undefined)

  const updatedAlert = alerts.get(alertId)
  if (updatedAlert) updatedAlert.lastFired = now.getTime()

  if (alert.webhookUrl) {
    const check = validateWebhookUrl(alert.webhookUrl)
    if (!check.valid) {
      console.error(`[ALERT] Rejected webhook delivery: ${check.error} for alert ${alertId}`)
      return
    }

    const secret = alert.webhookSecret || process.env.NEXUS_WEBHOOK_SECRET || 'nexus-default-secret'
    const result = await deliverWebhook(alert.webhookUrl, {
      id: event.alertId,
      triggerType: alert.condition ?? alert.triggerType ?? "",
      conditions: {},
      event: event as unknown as Record<string, unknown>,
      timestamp: new Date(event.triggeredAt).toISOString(),
    }, secret)

    if (!result.success) {
      console.error(`[ALERT] Webhook delivery failed for ${alertId}: ${result.error} (${result.attempts} attempts)`)
    }
  }

  console.log(`[ALERT] ${alert.name || 'Unnamed alert'}: ${message}`)
}

export function getAlertLog(limit = 50): AlertEvent[] {
  return alertLog.slice(-limit)
}

export async function getAlertCount(): Promise<number> {
  if (alerts.size === 0) {
    return prisma.alert.count()
  }
  return alerts.size
}
