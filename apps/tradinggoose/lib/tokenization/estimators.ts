/**
 * Token estimation and accurate counting functions for different providers
 */

import { encodingForModel, type Tiktoken } from 'js-tiktoken'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('TokenizationEstimators')

const encodingCache = new Map<string, Tiktoken>()

/**
 * Get or create a cached encoding for a model
 */
function getEncoding(modelName: string): Tiktoken {
  if (encodingCache.has(modelName)) {
    return encodingCache.get(modelName)!
  }

  try {
    const encoding = encodingForModel(
      modelName.split('/').at(-1) as Parameters<typeof encodingForModel>[0]
    )
    encodingCache.set(modelName, encoding)
    return encoding
  } catch (error) {
    logger.warn(`Failed to get encoding for model ${modelName}, falling back to cl100k_base`)
    const encoding = encodingForModel('gpt-4')
    encodingCache.set(modelName, encoding)
    return encoding
  }
}

/**
 * Get accurate token count for text using tiktoken
 * Used only for chunk sizing and batching metadata, never billing.
 */
export function getAccurateTokenCount(text: string, modelName = 'text-embedding-3-small'): number {
  if (!text || text.length === 0) {
    return 0
  }

  try {
    const encoding = getEncoding(modelName)
    const tokens = encoding.encode(text)
    return tokens.length
  } catch (error) {
    logger.error('Error counting tokens with tiktoken:', error)
    return Math.ceil(text.length / 4)
  }
}

/** Group whole inputs by token budget without modifying their contents. */
export function batchByTokenLimit(
  texts: string[],
  maxTokensPerBatch: number,
  modelName = 'text-embedding-3-small'
): string[][] {
  const batches: string[][] = []
  let currentBatch: string[] = []
  let currentTokenCount = 0

  for (const text of texts) {
    const tokenCount = getAccurateTokenCount(text, modelName)

    if (currentBatch.length > 0 && currentTokenCount + tokenCount > maxTokensPerBatch) {
      batches.push(currentBatch)
      currentBatch = [text]
      currentTokenCount = tokenCount
    } else {
      currentBatch.push(text)
      currentTokenCount += tokenCount
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}
