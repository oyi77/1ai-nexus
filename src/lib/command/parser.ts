// ─────────────────────────────────────────────────────────────
// Command Parser — Bloomberg-style "NOUN VERB [ARGS]" grammar
// §2.1 — every panel reachable by command, not just click
// ─────────────────────────────────────────────────────────────

export interface CommandDef {
  verb: string
  description: string
  domain: string
  handler: (subject: string, args: string[]) => string // returns route path
}

export interface ParsedCommand {
  subject: string
  verb: string
  args: string[]
  route: string | null
  error?: string
}

// Command registry — modules register their verbs
const commands = new Map<string, CommandDef>()

// History ring buffer
const history: string[] = []
const MAX_HISTORY = 20

export function registerCommand(def: CommandDef): void {
  commands.set(def.verb.toUpperCase(), def)
}

export function registerCommands(defs: CommandDef[]): void {
  for (const d of defs) registerCommand(d)
}

/**
 * Parse a command string into subject + verb + args.
 * Format: "SUBJECT VERB [ARG1 ARG2 ...]"
 * Examples:
 *   "BTC GP 1Y" → { subject: "BTC", verb: "GP", args: ["1Y"] }
 *   "VITALIK.ETH FLOW" → { subject: "VITALIK.ETH", verb: "FLOW", args: [] }
 *   "KIMCHI" → { subject: "", verb: "KIMCHI", args: [] }
 *   "LAST" → { subject: "", verb: "LAST", args: [] }
 */
export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim()
  if (!trimmed) return { subject: '', verb: '', args: [], route: null, error: 'Empty command' }

  const tokens = trimmed.split(/\s+/)
  const first = tokens[0].toUpperCase()

  // Check if first token is a known verb (no subject)
  if (commands.has(first)) {
    const def = commands.get(first)!
    addToHistory(trimmed)
    return {
      subject: '',
      verb: first,
      args: tokens.slice(1),
      route: def.handler('', tokens.slice(1)),
    }
  }

  // Subject + Verb pattern
  if (tokens.length < 2) {
    // Single token — check if it's a known subject shorthand
    const route = resolveSubject(first)
    if (route) {
      addToHistory(trimmed)
      return { subject: first, verb: '', args: [], route }
    }
    return { subject: first, verb: '', args: [], route: null, error: `Unknown command: ${first}` }
  }

  const verb = tokens[1].toUpperCase()
  const args = tokens.slice(2)

  if (!commands.has(verb)) {
    return { subject: first, verb, args, route: null, error: `Unknown verb: ${verb}. Try /help` }
  }

  const def = commands.get(verb)!
  addToHistory(trimmed)
  return {
    subject: first,
    verb,
    args,
    route: def.handler(first, args),
  }
}

/**
 * Resolve a subject string to a default route.
 */
function resolveSubject(subject: string): string | null {
  // Known crypto tickers → token page
  const cryptoTickers = ['BTC', 'ETH', 'SOL', 'ARB', 'OP', 'LINK', 'AAVE', 'UNI', 'DOGE', 'AVAX', 'MATIC']
  if (cryptoTickers.includes(subject)) {
    return `/tokens?symbol=${subject}`
  }

  // ENS-style addresses
  if (subject.includes('.') || subject.startsWith('0x')) {
    return `/entities?q=${subject}`
  }

  // Region names → weather
  const regions = ['SUMATRA', 'KALIMANTAN', 'JAKARTA', 'TEXAS', 'EUROPE', 'ASIA']
  if (regions.includes(subject)) {
    return `/weather?region=${subject}`
  }

  return null
}

function addToHistory(cmd: string): void {
  history.unshift(cmd)
  if (history.length > MAX_HISTORY) history.pop()
}

export function getHistory(): string[] {
  return [...history]
}

export function clearHistory(): void {
  history.length = 0
}

// ─── Built-in commands ──────────────────────────────────────

registerCommands([
  {
    verb: 'GP',
    description: 'Open price graph for a ticker',
    domain: 'chart',
    handler: (subject, args) => {
      const period = args[0] || '1D'
      return `/tokens?symbol=${subject}&period=${period}`
    },
  },
  {
    verb: 'FLOW',
    description: 'Open entity flow visualizer',
    domain: 'onchain',
    handler: (subject) => `/entities?q=${subject}`,
  },
  {
    verb: 'KIMCHI',
    description: 'Open kimchi premium / cross-border premium board',
    domain: 'microstructure',
    handler: () => '/gaps?filter=kimchi',
  },
  {
    verb: 'GAPS',
    description: 'Open ranked dislocations board',
    domain: 'microstructure',
    handler: () => '/gaps',
  },
  {
    verb: 'NEW',
    description: 'Open new-pair scanner',
    domain: 'dex',
    handler: (subject) => `/dex?chain=${subject || 'all'}`,
  },
  {
    verb: 'LIQ',
    description: 'Open liquidation heatmap',
    domain: 'derivatives',
    handler: (subject) => `/derivatives?symbol=${subject || 'BTCUSDT'}&view=liquidations`,
  },
  {
    verb: 'NEWS',
    description: 'Open news feed filtered by country/region',
    domain: 'news',
    handler: (subject) => `/news?country=${subject || 'all'}`,
  },
  {
    verb: 'WX',
    description: 'Open weather/commodity signal view',
    domain: 'weather',
    handler: (subject) => `/weather?region=${subject || 'global'}`,
  },
  {
    verb: 'LAST',
    description: 'Show last 8 commands (Bloomberg-style)',
    domain: 'system',
    handler: () => '/history',
  },
  {
    verb: 'HELP',
    description: 'Show available commands',
    domain: 'system',
    handler: () => '/help',
  },
  {
    verb: 'STATUS',
    description: 'Open system status dashboard',
    domain: 'system',
    handler: () => '/status',
  },
  {
    verb: 'ALERT',
    description: 'Open alerts page',
    domain: 'system',
    handler: () => '/alerts',
  },
  {
    verb: 'DERIV',
    description: 'Open derivatives dashboard',
    domain: 'derivatives',
    handler: () => '/derivatives',
  },
  {
    verb: 'DEFI',
    description: 'Open DeFi overview',
    domain: 'defi',
    handler: () => '/defi',
  },
  {
    verb: 'SMART',
    description: 'Open smart money feed',
    domain: 'onchain',
    handler: () => '/smart-money',
  },
  {
    verb: 'PREDICT',
    description: 'Open prediction markets',
    domain: 'predictions',
    handler: () => '/predictions',
  },
])

/**
 * Get all registered commands for help display.
 */
export function getAllCommands(): CommandDef[] {
  return Array.from(commands.values())
}
