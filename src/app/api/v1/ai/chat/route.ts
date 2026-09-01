// ─────────────────────────────────────────────────────────────
// POST /api/v1/ai/chat — NEXUS AI Assistant
// Supports agent selection: whale, macro, rug, narrative, portfolio
// ─────────────────────────────────────────────────────────────

import { type NextRequest } from 'next/server'
import { apiJson, apiError } from '@/lib/api/response'
import { verifyToken } from '@/lib/jwt'
import { z } from 'zod/v4'
import { getAgent, AGENTS } from '@/lib/modules/ai-signals/agents'

const ChatRequest = z.object({
  message: z.string().min(1),
  agent: z.string().optional(),
})

const DEFAULT_SYSTEM_PROMPT = `You are NEXUS Intelligence — the embedded AI analyst in the NEXUS terminal.
You have real-time data access across: on-chain analytics, market prices,
macro economics, news, derivatives, equities, forex, and sentiment.
Respond like a senior cross-asset analyst: data-first, concise, no fluff.
Use terminal-style brevity. Reference exact numbers. Flag uncertainty.`

export async function GET() {
  return apiJson({
    agents: AGENTS.map(a => ({ id: a.id, name: a.name, description: a.description, icon: a.icon })),
  })
}

export async function POST(request: NextRequest) {
  let token: string | undefined
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    token = request.cookies.get('nexus-session')?.value
  }
  if (!token) return apiError('Authentication required', 401)

  const payload = await verifyToken(token)
  if (!payload?.userId) return apiError('Invalid or expired token', 401)

  try {
    const parsed = ChatRequest.safeParse(await request.json())
    if (!parsed.success) {
      return apiError('message required', 400)
    }
    const { message, agent: agentId } = parsed.data

    // OmniRoute gateway (OpenAI-compatible) — the ecosystem's unified LLM
    // router. Pooled providers/model combos, no single-vendor lock.
    const base = process.env.OMNIROUTE_BASE_URL || 'http://100.123.92.72:20128/v1'
    const apiKey = process.env.OMNIROUTE_API_KEY
    if (!apiKey) {
      return apiJson({ response: 'AI Assistant is not configured. Set OMNIROUTE_API_KEY.' })
    }

    const systemPrompt = agentId
      ? (getAgent(agentId)?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT)
      : DEFAULT_SYSTEM_PROMPT

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OMNIROUTE_MODEL || 'baicok/deepseek-v4-flash-vision-exp',
        max_tokens: 1024,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('OmniRoute API error:', res.status, err)
      return apiJson({ response: `AI service error (${res.status}). Check OmniRoute config.` })
    }

    const data: unknown = await res.json()
    const response = extractOpenAIResponse(data)

    return apiJson({ response, agent: agentId ?? 'general' })
  } catch (err) {
    console.error('AI chat error:', err)
    return apiJson({ response: 'AI service temporarily unavailable.' })
  }
}

/** Extract assistant content from an OpenAI-style chat.completion. */
function extractOpenAIResponse(data: unknown): string {
  if (!data || typeof data !== 'object') return 'No response from AI'
  const d = data as { choices?: Array<{ message?: { content?: string } }> }
  const content = d.choices?.[0]?.message?.content
  return typeof content === 'string' && content ? content : 'No response from AI'
}
