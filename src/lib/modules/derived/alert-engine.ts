// ─────────────────────────────────────────────────────────────
// Alert Delivery System
// Supports: webhook, console log (expandable to Telegram/email)
// ponytail: webhook-only, add Telegram/email when Vilona needs it
// ─────────────────────────────────────────────────────────────

export interface Alert {
  id: string
  templateId: string
  name: string
  condition: string
  webhookUrl?: string
  enabled: boolean
  lastFired?: number
  createdAt: number
}

export interface AlertEvent {
  alertId: string
  alertName: string
  triggeredAt: number
  value: unknown
  message: string
}

// In-memory alert store — ponytail: move to Postgres when >100 alerts
const alerts = new Map<string, Alert>()
const alertLog: AlertEvent[] = []
const MAX_LOG = 1000

export function createAlert(alert: Alert): Alert {
  alerts.set(alert.id, alert)
  return alert
}

export function getAlerts(): Alert[] {
  return Array.from(alerts.values())
}

export function deleteAlert(id: string): boolean {
  return alerts.delete(id)
}

export function toggleAlert(id: string): Alert | undefined {
  const alert = alerts.get(id)
  if (alert) alert.enabled = !alert.enabled
  return alert
}

export async function fireAlert(alertId: string, value: unknown, message: string): Promise<void> {
  const alert = alerts.get(alertId)
  if (!alert || !alert.enabled) return

  const event: AlertEvent = {
    alertId,
    alertName: alert.name,
    triggeredAt: Date.now(),
    value,
    message,
  }

  alertLog.push(event)
  if (alertLog.length > MAX_LOG) alertLog.shift()
  alert.lastFired = Date.now()

  // Deliver via webhook if configured
  if (alert.webhookUrl) {
    try {
      await fetch(alert.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      // Silent — webhook failure doesn't crash the app
    }
  }

  // Console log for debugging
  console.log(`[ALERT] ${alert.name}: ${message}`)
}

export function getAlertLog(limit = 50): AlertEvent[] {
  return alertLog.slice(-limit)
}

export function getAlertCount(): number {
  return alerts.size
}
