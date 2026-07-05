/**
 * Structured logger for production use.
 * Replaces console.log/error with leveled, structured output.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  context?: string
  data?: unknown
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL]
}

function formatEntry(entry: LogEntry): string {
  const { level, message, timestamp, context, data } = entry
  const prefix = context ? `[${context}]` : ''
  const dataStr = data ? ` ${JSON.stringify(data)}` : ''
  return `${timestamp} ${level.toUpperCase()} ${prefix} ${message}${dataStr}`
}

function log(level: LogLevel, message: string, context?: string, data?: unknown): void {
  if (!shouldLog(level)) return

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
    data,
  }

  const formatted = formatEntry(entry)

  switch (level) {
    case 'error':
      console.error(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    default:
      console.log(formatted)
  }
}

export const logger = {
  debug: (message: string, context?: string, data?: unknown) => log('debug', message, context, data),
  info: (message: string, context?: string, data?: unknown) => log('info', message, context, data),
  warn: (message: string, context?: string, data?: unknown) => log('warn', message, context, data),
  error: (message: string, context?: string, data?: unknown) => log('error', message, context, data),
}
