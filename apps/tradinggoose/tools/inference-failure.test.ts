/** @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getInferenceFacts } from '@/lib/mastra/result'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from './index'

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn(async () => 'internal-fixture'),
}))
afterEach(() => vi.unstubAllGlobals())

const accounting = {
  model: 'openai/gpt-4.1',
  tokens: { prompt: 120, completion: 3, total: 123 },
  cost: { total: 0.01, currency: 'USD', status: 'reported' },
}

it('retains trusted HTTP inference failures through generic workflow traces and settlement costs', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: 'Provider filtered the response', ...accounting }, { status: 500 })
    )
  )
  const block = {
    id: 'translate',
    metadata: { id: 'translate', name: 'Translate' },
    config: { tool: 'llm_chat' },
  } as SerializedBlock
  let failure: unknown
  try {
    await new GenericBlockHandler().execute(
      block,
      { model: accounting.model, context: 'Translate this', targetLanguage: 'Spanish' },
      {
        userId: 'actor',
        workflowId: 'workflow',
        workspaceId: 'workspace',
        executionId: 'execution',
        workflowLogId: 'log',
      } as ExecutionContext
    )
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect(getInferenceFacts(failure)).toMatchObject(accounting)
  const { traceSpans } = buildTraceSpans({
    logs: [
      {
        id: 'occurrence',
        blockId: block.id,
        blockType: 'translate',
        blockName: 'Translate',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 1,
        error: 'Provider filtered the response',
        output: accounting,
        inference: getInferenceFacts(failure),
      },
    ],
  } as unknown as ExecutionResult)
  expect(calculateCostSummary(traceSpans)).toMatchObject({
    totalCost: 0.01,
    modelCost: 0.01,
    totalTokens: 123,
  })
})

it('does not trust matching cost fields returned by an ordinary HTTP tool', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'External failure', ...accounting }, { status: 500 }))
  )
  const result = await executeTool('http_request', {
    url: 'https://example.com/response',
    method: 'GET',
  })
  expect(result.success).toBe(false)
  expect(result.output).toMatchObject(accounting)
  expect(getInferenceFacts(result.output)).toBeUndefined()
})
