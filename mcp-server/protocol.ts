// NEXUS MCP Server -- JSON-RPC protocol handler.

import { TOOLS } from './tools'
import { handleToolCall } from './router'

export async function handleMcpRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const method = body.method as string
  const id = body.id

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nexus-mcp', version: '2.0.0' },
      },
    }
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    }
  }

  if (method === 'tools/call') {
    const params = body.params as { name: string; arguments: Record<string, unknown> }
    try {
      const result = await handleToolCall(params.name, params.arguments ?? {})
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        },
      }
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  }
}
