import { randomUUID } from 'node:crypto'
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'
import { embedMany } from 'ai'
import {
  assertModelUsageAllowed,
  beginWorkflowModelUsage,
  type ModelUsageScope,
  recordModelUsage,
} from '@/lib/billing/model-usage'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveConfiguredModel } from '@/lib/mastra/connections'
import { calculateNativeCost } from '@/lib/mastra/pricing'
import { assertListedEmbeddingModel } from '@/lib/mastra/registry'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import { type NativeCost, sumNativeCosts } from '@/lib/mastra/usage'
import { batchByTokenLimit, getAccurateTokenCount } from '@/lib/tokenization'

const logger = createLogger('EmbeddingUtils')
const MAX_TOKENS_PER_REQUEST = 8000
export const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small'

export interface EmbeddingAccounting {
  model: string
  tokens: { prompt?: number; total?: number }
  usage: { status: 'reported' | 'partial' | 'unavailable'; batches: number }
  cost: NativeCost
}

export interface EmbeddingResult extends EmbeddingAccounting {
  embeddings: number[][]
}

export interface EmbeddingScope {
  actorUserId: string
  /** Request-local credential. */
  apiKey?: string
  workspaceId?: string | null
  workflowId?: string | null
  executionId?: string
  signal?: AbortSignal
  /** Server-issued and persisted by a background caller; never a client request field. */
  runId?: string
}

/** Token counts used for batching are metadata; only native response usage is accounting. */
export async function generateEmbeddings(
  texts: string[],
  scope: EmbeddingScope,
  model = DEFAULT_EMBEDDING_MODEL
): Promise<EmbeddingResult> {
  if (!scope.actorUserId?.trim()) throw new Error('Authenticated embedding actor is required')
  scope.signal?.throwIfAborted()
  const selected = await assertListedEmbeddingModel(model)
  // Validate native limits before grouping; accepted inputs stay intact above the 8000-token target.
  const largestInput = texts.reduce((largest, text) => {
    const count = getAccurateTokenCount(text, model)
    if (count > selected.maxInputTokens)
      throw Object.assign(
        new Error(`Embedding input exceeds ${model}'s ${selected.maxInputTokens} token limit.`),
        { status: 400 }
      )
    return Math.max(largest, count)
  }, 0)
  const batches = batchByTokenLimit(texts, Math.max(MAX_TOKENS_PER_REQUEST, largestInput), model)
  const apiKey = scope.apiKey
  if (apiKey !== undefined && !apiKey.trim())
    throw Object.assign(new Error('A nonempty request-local embedding API key is required'), {
      status: 400,
    })
  const funding: ModelUsageScope['funding'] = apiKey === undefined ? 'account' : 'byok'
  const embedder = new ModelRouterEmbeddingModel(await resolveConfiguredModel(model, apiKey))
  const embeddings: number[][] = []
  const costs: NativeCost[] = []
  const invocationId = randomUUID()
  let prompt: number | undefined
  let reportedBatches = 0
  const maxEmbeddings = await embedder.maxEmbeddingsPerCall
  let batchCount = 0
  let awaitingUsage = false
  const accounting = (failed = false): EmbeddingAccounting => ({
    model,
    tokens: prompt !== undefined ? { prompt, total: prompt } : {},
    usage: {
      status:
        reportedBatches === 0
          ? 'unavailable'
          : !failed && reportedBatches === batchCount
            ? 'reported'
            : 'partial',
      batches: batchCount,
    },
    cost: {
      ...sumNativeCosts(costs),
      ...(funding === 'byok' ? { accountCost: null } : {}),
    },
  })
  try {
    const usageScope: ModelUsageScope = {
      actorUserId: scope.actorUserId,
      workspaceId: scope.workspaceId,
      workflowId: scope.workflowId,
      executionId: scope.executionId,
      signal: scope.signal,
      runId: scope.runId ?? randomUUID(),
      purpose: 'embedding',
      funding,
      model,
    }
    for (const batch of batches) {
      const size =
        maxEmbeddings && Number.isSafeInteger(maxEmbeddings) && maxEmbeddings > 0
          ? maxEmbeddings
          : batch.length
      for (let index = 0; index < batch.length; index += size) {
        const values = batch.slice(index, index + size)
        await assertModelUsageAllowed(usageScope)
        const attemptId = `${usageScope.runId}:embedding:${invocationId}:${batchCount}`
        await beginWorkflowModelUsage(usageScope, attemptId)
        awaitingUsage = true
        const result = await embedMany({ model: embedder, values, abortSignal: scope.signal })
        const tokens = Number.isFinite(result.usage.tokens) ? result.usage.tokens : undefined
        batchCount += 1
        if (tokens !== undefined) {
          prompt = (prompt ?? 0) + tokens
          reportedBatches += 1
        }
        embeddings.push(...result.embeddings)
        const usage = tokens === undefined ? {} : { inputTokens: tokens, totalTokens: tokens }
        const cost = await calculateNativeCost(model, usage, result.providerMetadata)
        costs.push(cost)
        awaitingUsage = false
        costs[costs.length - 1] = await recordModelUsage(usageScope, usage, cost, attemptId)
        scope.signal?.throwIfAborted()
        if (result.embeddings.length !== values.length) {
          throw new Error(
            'Embedding provider returned a different vector count than the input count'
          )
        }
      }
    }
  } catch (error) {
    if (awaitingUsage) costs.push({ status: 'unavailable' })
    const failure = error instanceof Error ? error : new Error(String(error))
    // An already branded producer error owns its facts and readonly Symbol; retain it intact.
    if (getInferenceFacts(failure)) throw failure
    const { usage, ...completed } = accounting(true)
    Object.assign(failure, completed, { embeddingUsage: usage, completedEmbeddings: embeddings })
    withInferenceFacts(failure, {
      ...completed,
      embeddingUsage: usage,
      generatedFields: ['model', 'tokens', 'cost', 'embeddingUsage'],
    })
    logger.error('Embedding generation failed', { ...completed, embeddingUsage: usage })
    throw failure
  }
  const resultAccounting = accounting()
  logger.info('Generated embedding batches', { count: embeddings.length, ...resultAccounting })
  return withInferenceFacts(
    { embeddings, ...resultAccounting },
    {
      model: resultAccounting.model,
      tokens: resultAccounting.tokens,
      cost: resultAccounting.cost,
      embeddingUsage: resultAccounting.usage,
      generatedFields: ['model', 'tokens', 'cost'],
    }
  )
}

export async function generateSearchEmbedding(
  query: string,
  scope: EmbeddingScope,
  model = DEFAULT_EMBEDDING_MODEL
) {
  const { embeddings, ...accounting } = await generateEmbeddings([query], scope, model)
  return { embedding: embeddings[0], ...accounting }
}
