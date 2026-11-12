/** @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getInferenceFacts } from '@/lib/mastra/result'
import type { NativeCost } from '@/lib/mastra/usage'
import { createAgentToolSet } from '@/executor/handlers/agent/agent-handler'
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
    const { tools, toolResults } = createAgentToolSet(
      [
        {
          id: 'llm_chat',
          description: 'Completed inference',
          parameters: { type: 'object', properties: {} },
          params: { model: accounting.model, context: 'Generate an answer' },
        },
      ],
      {
        userId: 'actor',
        workflowId: 'workflow',
        workspaceId: 'workspace',
        executionId: 'execution',
        workflowLogId: 'log',
        toolExecutionId: 'parent-block',
      },
      undefined,
      { signal: cancelled.signal, abort: (reason) => cancelled.abort(reason) }
    )
    const nativeContext = {
      abortSignal: cancelled.signal,
      agent: {
        agentId: 'parent-agent',
        toolCallId: 'completed-call',
        messages: [],
        suspend: async () => {},
      },
    }
    await expect(tools.llm_chat.execute?.({}, nativeContext)).rejects.toThrow('Aborted')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(toolResults).toEqual([
      {
        toolCallId: 'completed-call',
        inference: {
          model: accounting.model,
          tokens: accounting.tokens,
          cost,
          generatedFields: ['model', 'tokens', 'cost'],
        },
      },
    ])
    expect(JSON.stringify(toolResults)).not.toContain(completed.content)
    expect(JSON.stringify(toolResults)).not.toContain(completed.apiKey)

    const { traceSpans } = buildTraceSpans({
      logs: [
        {
          id: 'parent-occurrence',
          blockId: 'parent-block',
          blockType: 'agent',
          blockName: 'Parent Agent',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: 1,
          error: 'Aborted',
          inference: {
            model: 'native/parent',
            tokens: { total: 7 },
            cost: { total: 0.004, status: 'reported' },
            toolResults,
            generatedFields: ['model', 'tokens', 'cost', 'toolResults'],
          },
        },
      ],
    } as unknown as ExecutionResult)
    const summary = calculateCostSummary(traceSpans)
    expect(summary).toMatchObject({
      totalTokens: 130,
      status: unavailable && !byok ? 'partial' : 'reported',
      unavailableComponents: unavailable && !byok ? 1 : 0,
    })
    expect(summary.availableTotal).toBeCloseTo(byok || unavailable ? 0.004 : 0.014)
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
