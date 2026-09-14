// NEXUS MCP Server -- shared types + config.

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const PORT = Number(process.env.MCP_PORT ?? 4402)
export const NEXUS_API = process.env.NEXUS_API_URL ?? 'http://localhost:4400'
