/** @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getInferenceFacts } from '@/lib/mastra/result'
import type { NativeCost } from '@/lib/mastra/usage'
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

it('retains trusted HTTP inference failures through generic workflow traces', async () => {
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
  expect(traceSpans[0].inference).toMatchObject(accounting)
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

it.each(
  [false, true].flatMap((byok) => [false, true].map((unavailable) => ({ byok, unavailable })))
)(
  'retains decoded tool facts on cancellation (BYOK=$byok, unknown=$unavailable)',
  async ({ byok, unavailable }) => {
    const cancelled = new AbortController()
    const cost: NativeCost = {
      ...(unavailable
        ? { status: 'unavailable' as const }
        : { ...accounting.cost, status: 'reported' as const }),
      ...(byok ? { accountCost: null } : {}),
    }
    const completed = {
      content: 'Completed provider answer',
      ...accounting,
      cost,
      apiKey: 'private-response-key',
    }
    const fetcher = vi.fn(async () => {
      const response = Response.json(completed)
      vi.spyOn(response, 'json').mockImplementation(async () => {
        cancelled.abort()
        return completed
      })
      return response
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await executeTool(
      'llm_chat',
      { model: accounting.model, context: 'Generate an answer' },
      false,
      undefined,
      { signal: cancelled.signal }
    )
    expect(result.success).toBe(false)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(getInferenceFacts(result.output)).toMatchObject({
      model: accounting.model,
      tokens: accounting.tokens,
      cost,
    })
    expect(JSON.stringify(getInferenceFacts(result.output))).not.toContain(completed.content)
    expect(JSON.stringify(getInferenceFacts(result.output))).not.toContain(completed.apiKey)
  }
)

it('does not turn a cancelled ordinary HTTP response into inference authority', async () => {
  const cancelled = new AbortController()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const response = Response.json(accounting)
      vi.spyOn(response, 'json').mockImplementation(async () => {
        cancelled.abort()
        return accounting
      })
      return response
    })
  )
  const result = await executeTool(
    'http_request',
    {
      url: 'https://example.com/response',
      method: 'GET',
    },
    false,
    undefined,
    { signal: cancelled.signal }
  )
  expect(result).toMatchObject({ success: false, error: 'Aborted' })
  expect(getInferenceFacts(result.output)).toBeUndefined()
})

it('does not contact inference or invent completed facts when already cancelled', async () => {
  const cancelled = new AbortController()
  cancelled.abort()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const result = await executeTool(
    'llm_chat',
    {
      model: accounting.model,
      context: 'Do not start',
    },
    false,
    undefined,
    { signal: cancelled.signal }
  )
  expect(result).toMatchObject({ success: false, error: 'Aborted', output: {} })
  expect(getInferenceFacts(result.output)).toBeUndefined()
  expect(fetcher).not.toHaveBeenCalled()
})
