// ─────────────────────────────────────────────────────────────
// POST /api/v1/ai/chat — NEXUS AI Assistant
// Supports agent selection: whale, macro, rug, narrative, portfolio
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
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
  return NextResponse.json({
    agents: AGENTS.map(a => ({ id: a.id, name: a.name, description: a.description, icon: a.icon })),
  })
}

export async function POST(request: Request) {
  try {
    const parsed = ChatRequest.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }
    const { message, agent: agentId } = parsed.data

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({
        response: 'AI Assistant is not configured. Add your Anthropic API key in Settings → Modules.',
      })
    }

    const systemPrompt = agentId
      ? (getAgent(agentId)?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT)
      : DEFAULT_SYSTEM_PROMPT

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Anthropic API error:', res.status, err)
      return NextResponse.json({
        response: `AI service error (${res.status}). Check your API key in Settings.`,
      })
    }

    const data: unknown = await res.json()
    const response = extractResponse(data)

    return NextResponse.json({ response, agent: agentId ?? 'general' })
  } catch (err) {
    console.error('AI chat error:', err)
    return NextResponse.json({ response: 'AI service temporarily unavailable.' })
  }
}

function extractResponse(data: unknown): string {
  if (!data || typeof data !== 'object' || !('content' in data)) return 'No response from AI'
  const content: unknown = data.content
  if (!Array.isArray(content) || content.length === 0) return 'No response from AI'
  const first: unknown = content[0]
  if (!first || typeof first !== 'object' || !('text' in first)) return 'No response from AI'
  const text: unknown = first.text
  return typeof text === 'string' ? text : 'No response from AI'
}
