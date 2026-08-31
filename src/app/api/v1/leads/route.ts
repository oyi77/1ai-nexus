import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_SOURCES = ['landing', 'pricing', 'referral']

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email) return apiError('Email is required', 400)
    if (!EMAIL_RE.test(email)) return apiError('Invalid email address', 400)

    const source = typeof body?.source === 'string' ? body.source.trim() : ''
    const finalSource = source && VALID_SOURCES.includes(source) ? source : 'landing'

    const updateData: { source?: string } = {}
    if (source) updateData.source = finalSource

    await prisma.lead.upsert({
      where: { email },
      create: { email, source: finalSource },
      update: updateData,
    })

    return apiJson({ success: true })
  } catch (err) {
    console.error('Lead capture error:', err)
    return apiError('Failed to save lead', 500)
  }
}