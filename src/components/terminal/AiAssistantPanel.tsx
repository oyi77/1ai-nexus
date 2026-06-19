"use client"

import { useState, useRef, useEffect } from "react"

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function AiAssistantPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Check if user has Anthropic key configured
    fetch('/api/v1/user/api-key?service=anthropic')
      .then(r => r.json())
      .then(d => setHasKey(d.hasKey ?? false))
      .catch(() => setHasKey(false))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.response ?? 'No response' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Failed to get response' }])
    } finally {
      setLoading(false)
    }
  }

  if (!hasKey) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-border-dim">
          <h3 className="text-xs font-mono text-accent-cyan">NEXUS AI ▸</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-text-dim text-xs space-y-2">
            <p className="text-sm">AI Assistant</p>
            <p className="text-text-muted">Add your Anthropic API key to enable the AI assistant.</p>
            <a
              href="/settings/modules"
              className="inline-block mt-2 px-3 py-1 bg-accent-cyan/20 text-accent-cyan text-xs rounded border border-accent-cyan/30 hover:bg-accent-cyan/30 transition-colors"
            >
              Go to Settings
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border-dim">
        <h3 className="text-xs font-mono text-accent-cyan">NEXUS AI ▸</h3>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-text-muted text-xs text-center py-8">
            Ask NEXUS about market data, on-chain analytics, or macro trends.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`text-xs ${msg.role === 'user' ? 'text-accent-cyan' : 'text-text-primary'}`}>
            <p className="font-mono text-[10px] text-text-muted mb-0.5">{msg.role === 'user' ? 'You' : 'NEXUS'}</p>
            <p className="whitespace-pre-wrap">{msg.content}</p>
          </div>
        ))}
        {loading && (
          <div className="text-text-dim text-xs animate-pulse">NEXUS is thinking...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-border-dim">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Ask NEXUS..."
            className="flex-1 bg-bg-deep border border-border-dim rounded px-2 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted focus:border-accent-cyan focus:outline-none"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-3 py-1.5 bg-accent-cyan/20 text-accent-cyan text-xs rounded border border-accent-cyan/30 hover:bg-accent-cyan/30 disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
