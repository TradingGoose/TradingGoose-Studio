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

/**
 * Truncate text to a maximum token count
 * Useful for handling texts that exceed model limits
 */
export function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  modelName = 'text-embedding-3-small'
): string {
  if (!text || maxTokens <= 0) {
    return ''
  }

  try {
    const encoding = getEncoding(modelName)
    const tokens = encoding.encode(text)

    if (tokens.length <= maxTokens) {
      return text
    }

    const truncatedTokens = tokens.slice(0, maxTokens)
    const truncatedText = encoding.decode(truncatedTokens)

    logger.warn(
      `Truncated text from ${tokens.length} to ${maxTokens} tokens (${text.length} to ${truncatedText.length} chars)`
    )

    return truncatedText
  } catch (error) {
    logger.error('Error truncating text:', error)
    const maxChars = maxTokens * 4
    return text.slice(0, maxChars)
  }
}

/**
 * Batch texts by token count to stay within API limits
 * Returns array of batches where each batch's total tokens <= maxTokensPerBatch
 */
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

    if (tokenCount > maxTokensPerBatch) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch)
        currentBatch = []
        currentTokenCount = 0
      }

      const truncated = truncateToTokenLimit(text, maxTokensPerBatch, modelName)
      batches.push([truncated])
      continue
    }

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
