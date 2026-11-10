import { randomUUID } from 'node:crypto'
import { ModelRouterEmbeddingModel } from '@mastra/core/llm'
import { FinancialPolicyError, financialFingerprint } from '@tradinggoose/billing'
import {
  acceptFinancialModelStep,
  admitFinancialModelStep,
  createFinancialInvocation,
} from '@/lib/billing/native-finance'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveConfiguredModel } from '@/lib/mastra/connections'
import { assertListedEmbeddingModel } from '@/lib/mastra/registry'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import type { NativeCost } from '@/lib/mastra/usage'
import { resolveOpenAIServiceConfig } from '@/lib/system-services/runtime'
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
  /** Explicit request-local credential; never stored in a financial binding or process environment. */
  apiKey?: string
  workspaceId?: string | null
  workflowId?: string | null
  signal?: AbortSignal
  /** Server-issued and persisted by a background caller; never a client request field. */
  runId?: string
  /** Server-only restrictions from a freshly verified originating operation. */
  expectedNamespace?: string
  verifySource?: () => Promise<void>
}

/** Token counts used for batching are metadata; only native response usage is accounting. */
export async function generateEmbeddings(
  texts: string[],
  scope: EmbeddingScope,
  model = DEFAULT_EMBEDDING_MODEL
): Promise<EmbeddingResult> {
  if (!scope.actorUserId?.trim()) throw new Error('Authenticated embedding actor is required')
  scope.signal?.throwIfAborted()
  const selected = assertListedEmbeddingModel(model)
  // Existing batchByTokenLimit truncates oversized entries. Validate first and choose a
  // grouping ceiling that keeps every accepted input byte intact, including 8001–8191 tokens.
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
  let apiKey = scope.apiKey
  if (apiKey !== undefined && !apiKey.trim())
    throw Object.assign(new Error('A nonempty request-local embedding API key is required'), {
      status: 400,
    })
  if (apiKey === undefined && model.startsWith('openai/'))
    apiKey = (await resolveOpenAIServiceConfig()).defaultApiKey || undefined
  const embedder = new ModelRouterEmbeddingModel(resolveConfiguredModel(model, apiKey))
  const embeddings: number[][] = []
  let prompt: number | undefined
  let reportedBatches = 0
  const maxEmbeddings = await embedder.maxEmbeddingsPerCall
  let batchCount = 0
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
    // Standalone doEmbed results supply usage, not native generation cost metrics.
    cost: { status: 'unavailable' },
  })
  try {
    await scope.verifySource?.()
    scope.signal?.throwIfAborted()
    const runId = scope.runId ?? randomUUID()
    const invocation: Parameters<typeof createFinancialInvocation>[0] = {
      actorUserId: scope.actorUserId,
      workspaceId: scope.workspaceId,
      workflowId: scope.workflowId,
      runId,
      operationKey: runId,
      purpose: 'embedding',
      ...(scope.expectedNamespace !== undefined
        ? { expectedNamespace: scope.expectedNamespace }
        : {}),
    }
    const binding = batches.length ? await createFinancialInvocation(invocation) : null
    let stepNumber = 0
    for (const batch of batches) {
      const size =
        maxEmbeddings && Number.isSafeInteger(maxEmbeddings) && maxEmbeddings > 0
          ? maxEmbeddings
          : batch.length
      for (let index = 0; index < batch.length; index += size) {
        const values = batch.slice(index, index + size)
        const occurrence = { runId, stepNumber: stepNumber++, retryCount: 0 }
        scope.signal?.throwIfAborted()
        if (!binding) throw new Error('Embedding financial binding is required')
        await admitFinancialModelStep(binding, occurrence)
        scope.signal?.throwIfAborted()
        await scope.verifySource?.()
        scope.signal?.throwIfAborted()
        if (invocation.expectedNamespace !== undefined) {
          // Reuse this child's exact idempotent input. Current authorization and
          // the transaction-local namespace guard must still select its admitted binding.
          const current = await createFinancialInvocation(invocation)
          if (!current || financialFingerprint(current) !== financialFingerprint(binding))
            throw new FinancialPolicyError(
              'Embedding financial binding changed before contact',
              403
            )
          scope.signal?.throwIfAborted()
        }
        const result = await embedder.doEmbed({ values, abortSignal: scope.signal })
        batchCount += 1
        if (result.usage?.tokens !== undefined) {
          prompt = (prompt ?? 0) + result.usage.tokens
          reportedBatches += 1
        }
        embeddings.push(...result.embeddings)
        await acceptFinancialModelStep(binding, {
          ...occurrence,
          usage:
            result.usage?.tokens === undefined
              ? undefined
              : { inputTokens: result.usage.tokens, totalTokens: result.usage.tokens },
        })
        scope.signal?.throwIfAborted()
        if (result.embeddings.length !== values.length) {
          throw new Error(
            'Embedding provider returned a different vector count than the input count'
          )
        }
      }
    }
  } catch (error) {
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
