"use client"

import { useState, useRef, useEffect } from "react"

interface Message {
  role: 'user' | 'assistant'
  content: string
  agent?: string
}

interface Agent {
  id: string
  name: string
  description: string
  icon: string
}

export function AiAssistantPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/v1/user/api-key?service=anthropic')
      .then(r => r.json())
      .then(d => setHasKey(d.hasKey ?? false))
      .catch(() => setHasKey(false))

    fetch('/api/v1/ai/chat')
      .then(r => r.json())
      .then(d => setAgents(d.agents ?? []))
      .catch(() => {})
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
      const body: { message: string; agent?: string } = { message: userMessage }
      if (selectedAgent) body.agent = selectedAgent
      const res = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.response ?? 'No response', agent: data.agent }])
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

      {/* Agent selector */}
      {agents.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border-dim flex gap-1 overflow-x-auto scrollbar-thin">
          <button
            onClick={() => setSelectedAgent('')}
            className={`px-1.5 py-0.5 rounded text-[9px] border shrink-0 ${
              !selectedAgent ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim'
            }`}
          >GENERAL</button>
          {agents.map(a => (
            <button
              key={a.id}
              onClick={() => setSelectedAgent(selectedAgent === a.id ? '' : a.id)}
              className={`px-1.5 py-0.5 rounded text-[9px] border shrink-0 ${
                selectedAgent === a.id ? 'bg-border-active border-border-active text-text-primary' : 'bg-bg-panel border-border-dim text-text-dim'
              }`}
            >{a.icon} {a.name.split(' ')[0].toUpperCase()}</button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-text-muted text-xs text-center py-8">
            Ask NEXUS about market data, on-chain analytics, or macro trends.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`text-xs ${msg.role === 'user' ? 'text-accent-cyan' : 'text-text-primary'}`}>
            <p className="font-mono text-[10px] text-text-muted mb-0.5">
              {msg.role === 'user' ? 'You' : `NEXUS${msg.agent ? ` (${msg.agent})` : ''}`}
            </p>
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
            placeholder={selectedAgent ? `Ask ${selectedAgent} agent...` : 'Ask NEXUS...'}
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
