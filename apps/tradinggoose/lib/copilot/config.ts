import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotConfig')

export interface CopilotConfig {
  rag: {
    similarityThreshold: number
  }
}

function parseFloatEnv(value: string | undefined, name: string): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) {
    logger.warn(`Invalid ${name}: ${value}. Expected a valid number.`)
    return null
  }
  return parsed
}

export const DEFAULT_COPILOT_CONFIG: CopilotConfig = {
  rag: {
    similarityThreshold: 0.3,
  },
}

function applyEnvironmentOverrides(config: CopilotConfig): void {
  const ragSimilarityThreshold = parseFloatEnv(
    process.env.COPILOT_RAG_SIMILARITY_THRESHOLD,
    'COPILOT_RAG_SIMILARITY_THRESHOLD'
  )
  if (ragSimilarityThreshold !== null) {
    config.rag.similarityThreshold = ragSimilarityThreshold
  }
}

export function getCopilotConfig(): CopilotConfig {
  const config = structuredClone(DEFAULT_COPILOT_CONFIG)

  try {
    applyEnvironmentOverrides(config)
  } catch (error) {
    logger.warn('Error applying environment variable overrides, using defaults', { error })
  }

  return config
}
