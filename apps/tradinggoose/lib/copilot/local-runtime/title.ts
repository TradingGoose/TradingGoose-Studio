import OpenAI from 'openai'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveVllmServiceConfig } from '@/lib/system-services/runtime'
import { LOCAL_COPILOT_MODEL_PREFIX } from '@/lib/copilot/local-runtime/runtime-models'
import {
  TITLE_GENERATION_SYSTEM_PROMPT,
  TITLE_GENERATION_USER_PROMPT,
} from '@/lib/copilot/prompts'

const logger = createLogger('LocalCopilotTitle')

const TITLE_TIMEOUT_MS = 20_000
const MAX_TITLE_LENGTH = 80

function normalizeTitle(raw: string): string | null {
  const title = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .split('\n')[0]
    .trim()
  if (!title) return null
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title
}

/**
 * Generates a chat title with the self-hosted model. Mirrors the hosted
 * implementation in `lib/copilot/agent/utils.ts`.
 */
export async function requestLocalCopilotTitle(params: {
  message: string
  userId: string
  model: string
}): Promise<string | null> {
  try {
    const vllmConfig = await resolveVllmServiceConfig()
    const baseUrl = (vllmConfig.baseUrl || '').replace(/\/$/, '')
    if (!baseUrl) return null

    const modelId = params.model.startsWith(LOCAL_COPILOT_MODEL_PREFIX)
      ? params.model.slice(LOCAL_COPILOT_MODEL_PREFIX.length)
      : params.model

    const client = new OpenAI({
      baseURL: `${baseUrl}/v1`,
      apiKey: vllmConfig.apiKey || 'empty',
      timeout: TITLE_TIMEOUT_MS,
      maxRetries: 0,
    })

    const completion = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: TITLE_GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: TITLE_GENERATION_USER_PROMPT(params.message) },
      ],
      max_tokens: 32,
      stream: false,
    })

    const raw = completion.choices?.[0]?.message?.content
    if (typeof raw !== 'string') return null
    return normalizeTitle(raw)
  } catch (error) {
    logger.warn('Local copilot title generation failed', { error })
    return null
  }
}
