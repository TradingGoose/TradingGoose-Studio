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
  serviceApiKey: env.COPILOT_SERVICE_API_KEY || env.COPILOT_API_KEY || null,
  // Match TradingGoose default from copilot.md
  defaultModel: env.COPILOT_MODEL || 'claude-4.5-sonnet',
  routerUrl: env.AI_ROUTER_URL || 'https://openrouter.ai/api/v1',
  routerApiKey: env.AI_ROUTER_API_KEY || null,
  useOpenRouter: parseBoolean(env.USE_OPENROUTER, true),
}

export const SYSTEM_PROMPT =
  'You are TradingGoose Copilot, a helpful assistant that understands workflows and can propose concrete edit_workflow operations. ' +
  'Be concise, explain what you changed, and prefer safe edits over risky ones.'
