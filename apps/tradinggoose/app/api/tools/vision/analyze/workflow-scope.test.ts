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
  owner: vi.fn(),
  requests: [] as NextRequest[],
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: async () => ({ success: true, userId: 'authenticated-actor' }),
}))
vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: async () => 'synthetic-internal-auth',
}))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: boundary.owner }))
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
  executionId: 'execution-1',
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
  boundary.accept.mockImplementation(async (_scope, _usage, cost) => cost)
  boundary.owner.mockResolvedValue({
    ok: true,
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    userId: context.userId,
    executionId: context.executionId,
  })
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
      model: 'openai/gpt-4.1',
      workflowId: context.workflowId,
      executionId: context.executionId,
      workspaceId: context.workspaceId,
      purpose: 'vision',
    })
  )
  expect(boundary.admit).toHaveBeenCalledOnce()
  expect(boundary.accept).toHaveBeenCalledOnce()
  expect(boundary.accept.mock.calls[0][2]).toMatchObject({
    total: expect.closeTo(0.000012, 10),
    currency: 'USD',
    status: 'estimated',
  })
  expect(boundary.contact).toHaveBeenCalledOnce()
}
it('carries the actual vision_tool URL-only scope through real route, Agent and usage processors', async () => {
  const output = await executeTool(
    'vision_tool',
    {
      model: 'openai/gpt-4.1',
      imageUrl: 'data:image/png;base64,aW1hZ2U=',
      prompt: 'literal original input',
      _context: { workspaceId: 'forged', workflowId: 'forged', userId: 'forged' },
    },
    false,
    context
  )
  expect(output).toMatchObject({ success: true, output: { content: 'exact scoped output' } })
  expect(await boundary.requests[0].json()).not.toHaveProperty('workspaceId')
  assertScope()
})
it('retains Vision generic execution scope through the same vision_tool path', async () => {
  const block = {
    id: 'vision-block',
    metadata: { id: 'vision', name: 'Vision' },
    config: { tool: 'vision_tool' },
  }
  const output = await new GenericBlockHandler().execute(
    block as Parameters<GenericBlockHandler['execute']>[0],
    {
      model: 'openai/gpt-4.1',
      imageUrl: 'data:image/png;base64,aW1hZ2U=',
      prompt: 'literal to inspect',
    },
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
        id: 'vision_tool',
        description: 'Nested image tool',
        parameters: {
          type: 'object',
          properties: { prompt: { type: 'string' } },
          required: ['prompt'],
        },
        params: { model: 'openai/gpt-4.1', imageUrl: 'data:image/png;base64,aW1hZ2U=' },
      },
    ],
    { workflowId: context.workflowId, workspaceId: context.workspaceId, userId: context.userId },
    context,
    { signal: abortController.signal, abort: (reason) => abortController.abort(reason) }
  )
  const output = await native.tools.vision_tool.execute!({ prompt: 'nested literal' }, {})
  expect(output).toMatchObject({ content: 'exact scoped output' })
  assertScope()
})
it('denies a canonical authorization failure before admission/model contact without falling back to personal', async () => {
  boundary.owner.mockResolvedValue({
    ok: false,
    error: 'Workflow authorization denied',
    status: 403,
  })
  const output = await executeTool(
    'vision_tool',
    { model: 'openai/gpt-4.1', imageUrl: 'data:image/png;base64,aW1hZ2U=', prompt: 'literal' },
    false,
    context
  )
  expect(output.success).toBe(false)
  expect(boundary.admit).not.toHaveBeenCalled()
  expect(boundary.accept).not.toHaveBeenCalled()
  expect(boundary.contact).not.toHaveBeenCalled()
})
