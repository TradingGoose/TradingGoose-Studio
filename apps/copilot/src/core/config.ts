import { env } from 'bun'

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  return value.toLowerCase() === 'true'
}

export const config = {
  port: parseNumber(env.PORT, 5001),
  // Service-to-service auth (shared with main TG)
  internalApiSecret: env.INTERNAL_API_SECRET || null,
  officialTgUrl: env.OFFICIAL_TG_URL || null,
  // Match TradingGoose default from copilot.md
  defaultModel: env.COPILOT_MODEL || 'claude-4.5-sonnet',
  routerUrl: env.AI_ROUTER_URL || 'https://openrouter.ai/api/v1',
  routerApiKey: env.AI_ROUTER_API_KEY || null,
  useOpenRouter: parseBoolean(env.USE_OPENROUTER, true),
}
