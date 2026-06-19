// ─────────────────────────────────────────────────────────────
// POST /api/v1/alerts/create — Create an alert
// GET /api/v1/alerts/create — List active alerts + log
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { z } from 'zod/v4'
import { createAlert, getAlerts, getAlertLog } from '@/lib/modules/derived/alert-engine'

const CreateAlertSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1),
  condition: z.string().min(1),
  webhookUrl: z.string().optional(),
})

export async function GET() {
  return NextResponse.json({
    alerts: getAlerts(),
    log: getAlertLog(20),
  })
}

export async function POST(request: Request) {
  const parsed = CreateAlertSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid alert config' }, { status: 400 })
  }

  const alert = createAlert({
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: parsed.data.templateId,
    name: parsed.data.name,
    condition: parsed.data.condition,
    webhookUrl: parsed.data.webhookUrl,
    enabled: true,
    createdAt: Date.now(),
  })

  return NextResponse.json({ alert, message: 'Alert created' })
}
