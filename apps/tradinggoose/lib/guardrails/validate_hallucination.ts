import { Agent } from '@mastra/core/agent'
import { toStandardSchema } from '@mastra/core/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { safeInferenceError } from '@/lib/mastra/errors'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { prepareModelRequest } from '@/lib/mastra/request'
import { assertNativeCompletion } from '@/lib/mastra/result'
import { type NativeCost, sumNativeCosts } from '@/lib/mastra/usage'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('HallucinationValidator')

export interface HallucinationValidationResult {
  passed: boolean
  error?: string
  score?: number
  reasoning?: string
  tokens?: { prompt?: number; completion?: number; total?: number }
  cost?: NativeCost
  embeddingUsage?: { status: string; batches: number }
}

export interface HallucinationValidationInput {
  userInput: string
  knowledgeBaseId: string
  threshold: number // 0-10 confidence scale, default 3 (scores below 3 fail)
  topK: number // Number of chunks to retrieve, default 10
  model: string
  apiKey?: string
  workflowId?: string
  executionId?: string
  userId?: string
  workspaceId?: string
  requestId: string
  authHeaders: Headers
  signal?: AbortSignal
}

/**
 * Use an LLM to score confidence based on RAG context
 * Returns a confidence score from 0-10 where:
 * - 0 = full hallucination (completely unsupported)
 * - 10 = fully grounded (completely supported)
 */
async function scoreHallucinationWithLLM(
  userInput: string,
  ragContext: string[],
  model: string,
  apiKey: string | undefined,
  requestId: string,
  userId?: string,
  workspaceId?: string,
  externalSignal?: AbortSignal,
  workflowId?: string,
  executionId?: string
): Promise<{
  score: number
  reasoning: string
  tokens?: { prompt?: number; completion?: number; total?: number }
  cost?: NativeCost
}> {
  let work: Awaited<ReturnType<typeof prepareModelRequest>> | undefined
  try {
    const contextText = ragContext.join('\n\n---\n\n')

    const systemPrompt = `You are a confidence scoring system. Your job is to evaluate how well a user's input is supported by the provided reference context from a knowledge base.

Score the input on a confidence scale from 0 to 10:
- 0-2: Full hallucination - completely unsupported by context, contradicts the context
- 3-4: Low confidence - mostly unsupported, significant claims not in context
- 5-6: Medium confidence - partially supported, some claims not in context
- 7-8: High confidence - mostly supported, minor details not in context
- 9-10: Very high confidence - fully supported by context, all claims verified

Respond ONLY with valid JSON in this exact format:
{
  "score": <number between 0-10>,
  "reasoning": "<brief explanation of your score>"
}

Do not include any other text, markdown formatting, or code blocks. Only output the raw JSON object. Be strict - only give high scores (7+) if the input is well-supported by the context.`

    const userPrompt = `Reference Context:
${contextText}

User Input to Evaluate:
${userInput}

Evaluate the consistency and provide your score and reasoning in JSON format.`

    logger.info(`[${requestId}] Calling LLM for hallucination scoring`, {
      model,
      contextChunks: ragContext.length,
    })

    await assertListedModel(model)
    const signal = AbortSignal.any([
      AbortSignal.timeout(120000),
      ...(externalSignal ? [externalSignal] : []),
    ])
    work = await prepareModelRequest(
      {
        model,
        actorUserId: userId,
        workspaceId,
        runId: requestId,
        purpose: 'hallucination-scoring',
        funding: apiKey ? 'byok' : 'account',
        signal,
        workflowId,
        executionId,
      },
      { apiKey, modelSettings: { temperature: 0.1 } }
    )
    const agent = new Agent({
      ...NATIVE_AGENT_POLICY,
      id: requestId,
      name: 'Hallucination Validator',
      instructions: systemPrompt,
      model: work.model,
      mastra: work.mastra,
    })
    const response = await agent.generate([{ role: 'user', content: userPrompt }], {
      ...work.options,
      structuredOutput: {
        schema: toStandardSchema({
          type: 'object',
          properties: {
            score: { type: 'number', minimum: 0, maximum: 10 },
            reasoning: { type: 'string' },
          },
          required: ['score', 'reasoning'],
          additionalProperties: false,
        }),
        errorStrategy: 'strict',
        jsonPromptInjection: true,
      },
    })
    assertNativeCompletion(response)
    await work.usage.verifyComplete()
    const accounting = work.accounting()
    const result = response.object as { score: number; reasoning: string }

    if (!result || typeof result.score !== 'number' || result.score < 0 || result.score > 10) {
      throw new Error('Invalid score format from LLM')
    }

    logger.info(`[${requestId}] Confidence score: ${result.score}/10`, {
      reasoning: result.reasoning,
    })

    return {
      score: result.score,
      reasoning: result.reasoning || 'No reasoning provided',
      ...accounting,
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error scoring with LLM`, {
      error: safeInferenceError(error, apiKey),
    })
    throw Object.assign(
      new Error(`Failed to score confidence: ${safeInferenceError(error, apiKey)}`),
      {
        model,
        ...work?.accounting(),
      }
    )
  }
}

/** Search and scoring are distinct active calls; missing facts are never inferred as zero. */
function combineAccounting(
  ...parts: Array<Pick<HallucinationValidationResult, 'tokens' | 'cost'> | undefined>
) {
  const tokens: NonNullable<HallucinationValidationResult['tokens']> = {}
  for (const part of parts) {
    for (const key of ['prompt', 'completion', 'total'] as const) {
      const count = part?.tokens?.[key]
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0)
        tokens[key] = (tokens[key] ?? 0) + count
    }
  }
  const cost = sumNativeCosts(
    parts.filter((part) => part !== undefined).map((part) => part.cost ?? { status: 'unavailable' })
  )
  return { tokens, cost }
}

/**
 * Validate user input against knowledge base using RAG + LLM scoring
 */
export async function validateHallucination(
  input: HallucinationValidationInput
): Promise<HallucinationValidationResult> {
  const {
    userInput,
    knowledgeBaseId,
    threshold,
    topK,
    model,
    apiKey,
    workflowId,
    userId,
    workspaceId,
    requestId,
    authHeaders,
  } = input

  let searchAccounting:
    | Pick<HallucinationValidationResult, 'tokens' | 'cost' | 'embeddingUsage'>
    | undefined
  try {
    if (!userInput || userInput.trim().length === 0) {
      return {
        passed: false,
        error: 'User input is required',
      }
    }

    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const name of ['authorization', 'cookie', 'x-api-key']) {
      const value = authHeaders.get(name)
      if (value) headers.set(name, value)
    }
    const response = await fetch(`${getBaseUrl()}/api/knowledge/search`, {
      method: 'POST',
      headers,
      redirect: 'error',
      signal: input.signal,
      body: JSON.stringify({
        knowledgeBaseIds: [knowledgeBaseId],
        query: userInput,
        topK,
        workflowId,
      }),
    })
    const payload = await response.json()
    const data = payload.data ?? payload
    if (data.cost || data.tokens || data.embeddingUsage) {
      searchAccounting = {
        tokens: data.tokens ?? data.cost?.tokens,
        cost: data.cost ?? { status: 'unavailable' },
        embeddingUsage: data.embeddingUsage,
      }
    }
    if (!response.ok) {
      throw new Error(`Knowledge base query failed (${response.status})`)
    }
    const ragContext = data.results
      .map((result: { content: string }) => result.content)
      .filter(Boolean)

    if (ragContext.length === 0) {
      return {
        passed: false,
        error: 'No relevant context found in knowledge base',
        ...combineAccounting(searchAccounting),
        embeddingUsage: searchAccounting?.embeddingUsage,
      }
    }

    // Step 2: Use LLM to score confidence
    const { score, reasoning, tokens, cost } = await scoreHallucinationWithLLM(
      userInput,
      ragContext,
      model,
      apiKey,
      requestId,
      userId,
      workspaceId,
      input.signal,
      workflowId,
      input.executionId
    )

    logger.info(`[${requestId}] Confidence score: ${score}`, {
      reasoning,
      threshold,
    })

    // Step 3: Check against threshold. Lower scores = less confidence = fail validation
    const passed = score >= threshold

    return {
      passed,
      score,
      reasoning,
      ...combineAccounting(searchAccounting, { tokens, cost }),
      embeddingUsage: searchAccounting?.embeddingUsage,
      error: passed
        ? undefined
        : `Low confidence: score ${score}/10 is below threshold ${threshold}`,
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Hallucination validation error`, {
      error: safeInferenceError(error, apiKey),
    })
    return {
      passed: false,
      error: `Validation error: ${safeInferenceError(error, apiKey)}`,
      ...combineAccounting(searchAccounting, error),
      embeddingUsage: searchAccounting?.embeddingUsage,
    }
  }
}
