// NEXUS MCP tools -- barrel: concatenated registry.

import { TOOLS_MARKET } from './market'
import { TOOLS_DERIVATIVES } from './derivatives'
import { TOOLS_ONCHAIN } from './onchain'
import { TOOLS_SMARTMONEY } from './smartMoney'
import { TOOLS_TOKENSDEFI } from './tokensDefi'
import { TOOLS_NEWSMACRO } from './newsMacro'
import { TOOLS_AISYSTEM } from './aiSystem'
import { TOOLS_SPECIALIZED } from './specialized'
import type { McpTool } from '../types'

export const TOOLS: McpTool[] = [
  ...TOOLS_MARKET,
  ...TOOLS_DERIVATIVES,
  ...TOOLS_ONCHAIN,
  ...TOOLS_SMARTMONEY,
  ...TOOLS_TOKENSDEFI,
  ...TOOLS_NEWSMACRO,
  ...TOOLS_AISYSTEM,
  ...TOOLS_SPECIALIZED,
]
