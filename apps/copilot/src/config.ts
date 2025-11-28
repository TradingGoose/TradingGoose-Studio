import { env } from 'bun'

export interface ServiceConfig {
  port: number
  serviceApiKey: string | null
  openaiApiKey: string | undefined
  defaultModel: string
  rateLimitWindowMs: number
  rateLimitMaxRequests: number
  gatewayUrl: string | null
  gatewayApiKey: string | null
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config: ServiceConfig = {
  port: parseNumber(env.PORT, 4001),
  serviceApiKey: env.COPILOT_SERVICE_API_KEY || env.COPILOT_API_KEY || null,
  openaiApiKey: env.OPENAI_API_KEY,
  // Match TradingGoose default from copilot.md
  defaultModel: env.COPILOT_MODEL || 'claude-4.5-sonnet',
  rateLimitWindowMs: parseNumber(env.COPILOT_RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMaxRequests: parseNumber(env.COPILOT_RATE_LIMIT_MAX, 60),
  gatewayUrl: env.LLM_GATEWAY_URL || null,
  gatewayApiKey: env.LLM_GATEWAY_API_KEY || null,
}

export const SYSTEM_PROMPT =
  'You are Sim Copilot, a helpful assistant that understands Sim Studio workflows and can propose concrete edit_workflow operations. ' +
  'Be concise, explain what you changed, and prefer safe edits over risky ones.'
