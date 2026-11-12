/** @vitest-environment node */
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { workflow, workflowExecutionLogs } from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateInternalToken, verifyInternalTokenDetailed } from '@/lib/auth/internal'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getInferenceFacts } from '@/lib/mastra/result'
import { createAgentToolSet } from '@/executor/handlers/agent/agent-handler'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import type { ExecutionContext, ExecutionResult } from '@/executor/types'
import { executeTool } from '@/tools'
import { POST } from './route'

const boundary = vi.hoisted(() => ({
  admit: vi.fn(),
  accept: vi.fn(),
  contact: vi.fn(),
  session: vi.fn(),
  select: vi.fn(),
  access: vi.fn(),
  activeExecution: undefined as
    | {
        workflowId: string
        workspaceId: string
        executionId: string
        actor: string
        ended: boolean
      }
    | undefined,
  finishReason: 'stop' as 'stop' | 'content-filter',
  requests: [] as NextRequest[],
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (query: SQL) => ({ limit: () => boundary.select(table, query) }),
      }),
    }),
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: boundary.session }))
vi.mock('@/lib/env', async (original) => ({
  ...(await original<object>()),
  env: { INTERNAL_API_SECRET: 'test-internal-signing-secret-123456' },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: boundary.access }))
vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkServerSideUsageLimits: boundary.admit,
}))
vi.mock('@/lib/billing/usage-accrual', () => ({ accrueUserUsageCost: boundary.accept }))
vi.mock('@/lib/billing/settings', () => ({ isBillingEnabledForRuntime: async () => true }))
vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkspaceBillingContext: async () => ({
    billingUserId: 'authenticated-actor',
    tier: {},
    scopeType: 'user',
    scopeId: 'authenticated-actor',
  }),
  resolveWorkflowBillingContext: async () => ({
    billingUserId: 'authenticated-actor',
    tier: {},
    scopeType: 'user',
    scopeId: 'authenticated-actor',
  }),
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
          finishReason: boundary.finishReason,
          usage:
            boundary.finishReason === 'content-filter'
              ? { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
              : { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
          warnings: [],
        }
      },
    }),
}))
const context: ExecutionContext = {
  workflowId: 'execution-workflow',
  workspaceId: 'execution-workspace',
  executionId: 'active-execution',
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
  boundary.finishReason = 'stop'
  boundary.admit.mockResolvedValue({ isExceeded: false })
  boundary.accept.mockImplementation(async ({ cost }) => ({
    currentUsageBefore: 0,
    currentUsageAfter: cost,
  }))
  boundary.session.mockResolvedValue({ user: { id: context.userId } })
  boundary.activeExecution = {
    workflowId: context.workflowId,
    workspaceId: context.workspaceId!,
    executionId: context.executionId!,
    actor: context.userId!,
    ended: false,
  }
  boundary.select.mockImplementation((table, query: SQL) => {
    if (table === workflow) return [{ workspaceId: context.workspaceId }]
    expect(table).toBe(workflowExecutionLogs)
    const statement = new PgDialect().sqlToQuery(query)
    const row = boundary.activeExecution
    return row &&
      !row.ended &&
      JSON.stringify(statement.params) ===
        JSON.stringify([row.workflowId, row.workspaceId, row.executionId, row.actor])
      ? [{ id: 'active-log' }]
      : []
  })
  boundary.access.mockResolvedValue({ hasAccess: true })
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
      userId: 'authenticated-actor',
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
    })
  )
  expect(boundary.admit).toHaveBeenCalledOnce()
  // Workflow logs own these tokens; the provider must not accrue them a second time.
  expect(boundary.accept).not.toHaveBeenCalled()
  expect(boundary.contact).toHaveBeenCalledOnce()
}

function workflowCosts(output: unknown) {
  const { traceSpans } = buildTraceSpans({
    logs: [
      {
        id: 'inference-occurrence',
        blockId: 'tool-block',
        blockType: 'api',
        blockName: 'Tool',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 1,
        output,
        inference: getInferenceFacts(output),
      },
    ],
  } as unknown as ExecutionResult)
  return calculateCostSummary(traceSpans)
}
it('carries the actual llm_chat URL-only scope through real route, Agent and usage processors', async () => {
  const output = await executeTool(
    'llm_chat',
    {
      model: 'openai/gpt-4.1',
      context: 'literal original input',
      _context: {
        workspaceId: 'forged',
        workflowId: 'forged',
        userId: 'forged',
        toolExecutionId: 'llm-block',
      },
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
  expect(workflowCosts(output)).toMatchObject({
    totalTokens: 3,
    totalCost: expect.closeTo(0.000012, 10),
  })
  assertScope()
})

it('charges an HTTP block that calls providers without claiming that its wrapped response settles model usage', async () => {
  const output = await new GenericBlockHandler().execute(
    {
      id: 'http-block',
      metadata: { id: 'api', name: 'HTTP Request' },
      config: { tool: 'http_request' },
    } as Parameters<GenericBlockHandler['execute']>[0],
    {
      url: '/api/providers',
      method: 'POST',
      body: {
        providerNamespace: 'ai',
        model: 'openai/gpt-4.1',
        executionId: context.executionId,
        settlesModelUsage: true,
        messages: [{ role: 'user', content: 'hello' }],
      },
    },
    context
  )
  expect(output.data).toMatchObject({ content: 'exact scoped output', tokens: { total: 3 } })
  expect(getInferenceFacts(output)).toBeUndefined()
  expect(workflowCosts(output)).toMatchObject({ totalCost: 0 })
  expect(boundary.accept).toHaveBeenCalledOnce()
  expect(
    boundary.select.mock.calls.filter(([table]) => table === workflowExecutionLogs)
  ).toHaveLength(0)
  const authorization = boundary.requests[0].headers.get('authorization')!
  const verification = await verifyInternalTokenDetailed(authorization.slice('Bearer '.length))
  expect(verification).toMatchObject({
    valid: true,
    userId: context.userId,
    workflowExecution: {
      parentWorkflowId: context.workflowId,
      parentExecutionId: context.executionId,
      parentBlockId: 'http-block',
    },
  })
  expect(verification.workflowExecution).not.toHaveProperty('settlesModelUsage')
})

it('settles an internal inference producer HTTP failure once through its parent workflow facts', async () => {
  boundary.finishReason = 'content-filter'
  let failure: unknown
  try {
    await new GenericBlockHandler().execute(
      {
        id: 'translate-block',
        metadata: { id: 'translate', name: 'Translate' },
        config: { tool: 'llm_chat' },
      } as Parameters<GenericBlockHandler['execute']>[0],
      {
        model: 'openai/gpt-4.1',
        context: 'literal to translate',
        targetLanguage: 'Spanish',
      },
      context
    )
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect(getInferenceFacts(failure)).toMatchObject({
    tokens: { prompt: 12, completion: 3, total: 15 },
  })
  expect(workflowCosts(failure)).toMatchObject({
    totalTokens: 15,
    totalCost: expect.closeTo(0.000048, 10),
  })
  expect(boundary.accept).not.toHaveBeenCalled()
  expect(
    boundary.select.mock.calls.filter(([table]) => table === workflowExecutionLogs)
  ).toHaveLength(1)
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
    {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      toolExecutionId: 'agent-block',
    },
    context,
    { signal: abortController.signal, abort: (reason) => abortController.abort(reason) }
  )
  const output = await native.tools.llm_chat.execute!({ context: 'nested literal' }, {})
  expect(output).toMatchObject({ content: 'exact scoped output' })
  assertScope()
})
it('denies a canonical authorization failure before admission/model contact without falling back to personal', async () => {
  boundary.access.mockResolvedValue({ hasAccess: false })
  const output = await executeTool(
    'llm_chat',
    { model: 'openai/gpt-4.1', context: 'literal' },
    false,
    context
  )
  expect(output.success).toBe(false)
  expect(boundary.admit).not.toHaveBeenCalled()
  expect(boundary.accept).not.toHaveBeenCalled()
  expect(boundary.contact).not.toHaveBeenCalled()
})

it.each(['personal-workspace', 'organization-workspace'])(
  'rejects unauthorized %s before admission, provider contact or ledger updates',
  async (workspaceId) => {
    boundary.access.mockResolvedValue({ hasAccess: false })
    const response = await POST(
      new NextRequest('http://localhost/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          providerNamespace: 'ai',
          model: 'openai/gpt-4.1',
          workspaceId,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      })
    )
    expect(response.status).toBe(403)
    expect(boundary.access).toHaveBeenCalledExactlyOnceWith(workspaceId, context.userId)
    expect(boundary.admit).not.toHaveBeenCalled()
    expect(boundary.contact).not.toHaveBeenCalled()
    expect(boundary.accept).not.toHaveBeenCalled()
  }
)

it('accounts for an authorized standalone workspace request through the real Agent and accounting path', async () => {
  const response = await POST(
    new NextRequest('http://localhost/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        providerNamespace: 'ai',
        model: 'openai/gpt-4.1',
        workspaceId: context.workspaceId,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })
  )
  expect(response.status).toBe(200)
  expect(boundary.accept).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      userId: context.userId,
      workspaceId: context.workspaceId,
      cost: expect.closeTo(0.000012, 10),
      extraUpdates: { totalTokensUsed: expect.anything() },
    })
  )
  expect(boundary.access.mock.invocationCallOrder[0]).toBeLessThan(
    boundary.admit.mock.invocationCallOrder[0]
  )
  expect(boundary.admit.mock.invocationCallOrder[0]).toBeLessThan(
    boundary.contact.mock.invocationCallOrder[0]
  )
})

it.each([true, false])(
  'retains workspace authorization for report-only BYOK usage (authorized=%s)',
  async (authorized) => {
    boundary.access.mockResolvedValue({ hasAccess: authorized })
    boundary.admit.mockResolvedValue({ isExceeded: true })
    const response = await POST(
      new NextRequest('http://localhost/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          providerNamespace: 'ai',
          model: 'openai/gpt-4.1',
          apiKey: 'caller-provider-key',
          funding: 'account',
          workspaceId: context.workspaceId,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      })
    )

    expect(response.status).toBe(authorized ? 200 : 403)
    expect(boundary.access).toHaveBeenCalledExactlyOnceWith(context.workspaceId, context.userId)
    expect(boundary.admit).not.toHaveBeenCalled()
    expect(boundary.accept).not.toHaveBeenCalled()
    expect(boundary.contact).toHaveBeenCalledTimes(authorized ? 1 : 0)
    const body = await response.json()
    if (authorized)
      expect(body).toMatchObject({
        content: 'exact scoped output',
        cost: {
          status: 'estimated',
          total: expect.closeTo(0.000012, 10),
          accountCost: null,
        },
      })
    expect(JSON.stringify(body)).not.toContain('caller-provider-key')
  }
)

it.each(['session', 'internal-without-execution', 'internal-without-settlement', 'other-workflow'])(
  'charges an authorized workflow request using %s even when its body claims an active execution',
  async (authentication) => {
    const token =
      authentication === 'session'
        ? undefined
        : await generateInternalToken(context.userId, {
            ...(['internal-without-settlement', 'other-workflow'].includes(authentication)
              ? {
                  workflowExecution: {
                    source: 'workflow_block',
                    parentWorkflowId:
                      authentication === 'other-workflow' ? 'other-workflow' : context.workflowId,
                    parentExecutionId: context.executionId,
                    parentBlockId: 'llm-block',
                    ...(authentication === 'other-workflow'
                      ? { settlesModelUsage: true as const }
                      : {}),
                  },
                }
              : {}),
          })
    const response = await POST(
      new NextRequest('http://localhost/api/providers', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({
          providerNamespace: 'ai',
          model: 'openai/gpt-4.1',
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
          executionId: context.executionId,
          settlesModelUsage: true,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      })
    )
    expect(response.status).toBe(200)
    expect(boundary.accept).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: context.userId,
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        cost: expect.closeTo(0.000012, 10),
        extraUpdates: { totalTokensUsed: expect.anything() },
      })
    )
    expect(
      boundary.select.mock.calls.filter(([table]) => table === workflowExecutionLogs)
    ).toHaveLength(0)
  }
)

it.each(['active', 'missing', 'ended', 'other-actor', 'other-workspace', 'other-workflow'])(
  'checks the signed execution against a matching active settlement log: %s',
  async (state) => {
    if (state === 'missing') boundary.activeExecution = undefined
    else if (state === 'ended') boundary.activeExecution!.ended = true
    else if (state === 'other-actor') boundary.activeExecution!.actor = 'other-actor'
    else if (state === 'other-workspace') boundary.activeExecution!.workspaceId = 'other-workspace'
    else if (state === 'other-workflow') boundary.activeExecution!.workflowId = 'other-workflow'
    const token = await generateInternalToken(context.userId, {
      workflowExecution: {
        source: 'workflow_block',
        parentWorkflowId: context.workflowId,
        parentExecutionId: context.executionId,
        parentBlockId: 'llm-block',
        settlesModelUsage: true,
      },
    })
    const response = await POST(
      new NextRequest('http://localhost/api/providers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          providerNamespace: 'ai',
          model: 'openai/gpt-4.1',
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      })
    )
    expect(response.status).toBe(200)
    expect(
      boundary.select.mock.calls.filter(([table]) => table === workflowExecutionLogs)
    ).toHaveLength(1)
    expect(boundary.accept).toHaveBeenCalledTimes(state === 'active' ? 0 : 1)
  }
)

it('retains filtered provider usage in the HTTP failure and records it once', async () => {
  boundary.finishReason = 'content-filter'
  const response = await POST(
    new NextRequest('http://localhost/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        providerNamespace: 'ai',
        model: 'openai/gpt-4.1',
        workspaceId: context.workspaceId,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })
  )
  expect(response.status).toBe(500)
  expect(await response.json()).toMatchObject({
    tokens: { prompt: 12, completion: 3, total: 15 },
    cost: { status: 'estimated', total: expect.closeTo(0.000048, 10) },
  })
  expect(boundary.accept).toHaveBeenCalledOnce()
  expect(boundary.contact).toHaveBeenCalledOnce()
})
