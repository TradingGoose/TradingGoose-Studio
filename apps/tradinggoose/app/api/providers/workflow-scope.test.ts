/** @vitest-environment node */
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAgentToolSet } from '@/executor/handlers/agent/agent-handler'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import type { ExecutionContext } from '@/executor/types'
import { executeTool } from '@/tools'
import { POST } from './route'

const boundary = vi.hoisted(() => ({
  admit: vi.fn(),
  accept: vi.fn(),
  contact: vi.fn(),
  requests: [] as NextRequest[],
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: async () => ({ success: true, userId: 'authenticated-actor' }),
}))
vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: async () => 'synthetic-internal-auth',
}))
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: boundary.admit,
  recordModelUsage: boundary.accept,
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))
vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<object>()),
  createConfiguredLanguageModel: () =>
    new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        boundary.contact()
        return {
          content: [{ type: 'text', text: 'exact scoped output' }],
          finishReason: 'stop',
          usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
          warnings: [],
        }
      },
    }),
}))
const context: ExecutionContext = {
  workflowId: 'execution-workflow',
  workspaceId: 'execution-workspace',
  userId: 'authenticated-actor',
  blockStates: new Map(),
  blockLogs: [],
  metadata: { startTime: new Date().toISOString(), duration: 0 },
  environmentVariables: {},
  decisions: { router: new Map(), condition: new Map() },
  loopIterations: new Map(),
  loopItems: new Map(),
  completedLoops: new Set(),
  executedBlocks: new Set(),
  activeExecutionPath: new Set(),
}
beforeEach(() => {
  vi.clearAllMocks()
  boundary.requests.length = 0
  boundary.admit.mockResolvedValue(undefined)
  boundary.accept.mockResolvedValue(undefined)
  vi.stubGlobal(
    'fetch',
    Object.assign(
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const request = new NextRequest(String(url), { ...init, signal: init?.signal ?? undefined })
        boundary.requests.push(request.clone() as NextRequest)
        return POST(request)
      }),
      { preconnect: vi.fn() }
    )
  )
})
afterEach(() => vi.unstubAllGlobals())
function assertScope() {
  expect(boundary.requests).toHaveLength(1)
  const url = new URL(boundary.requests[0].url)
  expect(url.searchParams.get('workflowId')).toBe(context.workflowId)
  expect(url.searchParams.get('workspaceId')).toBe(context.workspaceId)
  expect(boundary.admit).toHaveBeenCalledWith(
    expect.objectContaining({
      actorUserId: 'authenticated-actor',
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      purpose: 'workflow-provider',
    })
  )
  expect(boundary.admit).toHaveBeenCalledOnce()
  expect(boundary.accept).toHaveBeenCalledOnce()
  expect(boundary.contact).toHaveBeenCalledOnce()
}
it('carries the actual llm_chat URL-only scope through real route, Agent and usage processors', async () => {
  const output = await executeTool(
    'llm_chat',
    {
      model: 'openai/gpt-4.1',
      context: 'literal original input',
      _context: { workspaceId: 'forged', workflowId: 'forged', userId: 'forged' },
    },
    false,
    context
  )
  expect(output).toMatchObject({ success: true, output: { content: 'exact scoped output' } })
  expect(await boundary.requests[0].json()).not.toHaveProperty('workspaceId')
  assertScope()
})
it('retains Translate generic execution scope through the same llm_chat path', async () => {
  const block = {
    id: 'translate-block',
    metadata: { id: 'translate', name: 'Translate' },
    config: { tool: 'llm_chat' },
  }
  const output = await new GenericBlockHandler().execute(
    block as Parameters<GenericBlockHandler['execute']>[0],
    { model: 'openai/gpt-4.1', context: 'literal to translate', targetLanguage: 'Spanish' },
    context
  )
  expect(output.content).toBe('exact scoped output')
  assertScope()
})
it('retains a nested native tool callback scope instead of trusting its input identity', async () => {
  const abortController = new AbortController()
  const native = createAgentToolSet(
    [
      {
        id: 'llm_chat',
        description: 'Nested text tool',
        parameters: {
          type: 'object',
          properties: { context: { type: 'string' } },
          required: ['context'],
        },
        params: { model: 'openai/gpt-4.1' },
      },
    ],
    { workflowId: context.workflowId, workspaceId: context.workspaceId, userId: context.userId },
    context,
    { signal: abortController.signal, abort: (reason) => abortController.abort(reason) }
  )
  const output = await native.tools.llm_chat.execute!({ context: 'nested literal' }, {})
  expect(output).toMatchObject({ content: 'exact scoped output' })
  assertScope()
})
it('denies a canonical authorization failure before admission/model contact without falling back to personal', async () => {
  boundary.admit.mockRejectedValue(new Error('Workflow authorization denied'))
  const output = await executeTool(
    'llm_chat',
    { model: 'openai/gpt-4.1', context: 'literal' },
    false,
    context
  )
  expect(output.success).toBe(false)
  expect(boundary.admit).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: context.workspaceId, workflowId: context.workflowId })
  )
  expect(boundary.accept).not.toHaveBeenCalled()
  expect(boundary.contact).not.toHaveBeenCalled()
})
