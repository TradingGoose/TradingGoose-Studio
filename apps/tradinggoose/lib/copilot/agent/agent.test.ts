/** @vitest-environment node */
import { randomUUID } from 'node:crypto'
import { ModelRouterLanguageModel } from '@mastra/core/llm'
import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore } from '@mastra/core/storage'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import type { ServerPending as Pending } from '@/lib/copilot/native/target'
import { createCopilotAgent } from './agent'
import { createCopilotRequestContext, getCopilotExecution } from './context'

const m = vi.hoisted(() => ({
  model: undefined as any,
  route: vi.fn(),
  authorize: vi.fn(),
  business: vi.fn(),
  active: vi.fn(),
  effect: vi.fn(),
  global: vi.fn(),
}))
vi.mock('@/lib/copilot/native/target', async () => ({
  ...(await import('@/lib/copilot/native/errors')),
  authorizeNativeConversationScope: m.authorize,
}))
vi.mock('@/lib/copilot/native/business-access', () => ({
  authorizeNativeBusinessResult: m.business,
}))
vi.mock('@/lib/copilot/tools/server/router', () => ({
  routeExecution: m.route,
  isWorkspaceAgnosticServerTool: m.global,
}))
vi.mock('./state', () => ({
  assertCopilotRunActive: m.active,
  runCopilotEffectOnce: (...args: any[]) => m.effect(...args),
}))

function model(name?: string, args: Record<string, unknown> = {}) {
  let calls = 0
  return new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      const tool = name && calls++ === 0
      return {
        content: tool
          ? [
              {
                type: 'tool-call' as const,
                toolCallId: 'business-call',
                toolName: name,
                input: JSON.stringify(args),
              },
            ]
          : [{ type: 'text' as const, text: 'Done' }],
        finishReason: tool ? 'tool-calls' : 'stop',
        usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
        warnings: [],
      }
    },
  })
}
function harness(accessLevel: 'limited' | 'full' = 'full') {
  const runId = randomUUID()
  const scope = { actorUserId: 'actor', workspaceId: 'workspace' }
  const memory = new Memory({ storage: new InMemoryStore(), options: { generateTitle: false } })
  const agent = createCopilotAgent(memory)
  new Mastra({
    agents: { copilot: agent },
    storage: memory.storage,
    recovery: { workflows: 'off', durableAgents: 'off' },
  })
  const execution: Parameters<typeof createCopilotRequestContext>[0] = {
    run: {
      runId,
      threadId: `thread:${runId}`,
      scope,
      model: 'configured/model',
      accessLevel,
    },
    model: m.model,
    signal: new AbortController().signal,
  }
  const requestContext = createCopilotRequestContext(execution)
  const options = {
    runId,
    requestContext,
    memory: {
      thread: execution.run.threadId,
      resource: nativeConversationIdentity(scope).resourceId,
    },
    maxSteps: 2,
  }
  return { agent, execution: getCopilotExecution(requestContext)!, options }
}
beforeEach(() => {
  vi.clearAllMocks()
  m.route.mockReset()
  m.authorize.mockResolvedValue({ actorUserId: 'actor', workspaceId: 'workspace' })
  m.business.mockResolvedValue(undefined)
  m.active.mockResolvedValue(undefined)
  m.global.mockReset().mockReturnValue(false)
  m.effect.mockImplementation(async (_run, _call, _phase, execute) => execute())
})
afterEach(() => vi.unstubAllGlobals())
describe('Studio-owned Copilot tools', () => {
  it.each(['conversation-workspace', null])(
    'keeps global documentation billing in conversation scope %j instead of an attached entity',
    async (workspaceId) => {
      m.model = model('search_documentation', { query: 'workflow documentation' })
      m.global.mockImplementation((name) => name === 'search_documentation')
      m.route.mockResolvedValueOnce({ results: [] })
      const h = harness()
      h.execution.run.scope.workspaceId = workspaceId
      h.options.memory.resource = nativeConversationIdentity(h.execution.run.scope).resourceId
      h.execution.run.toolContext = {
        workspaceId: 'attached-entity-workspace',
        contextEntityKind: 'workflow',
        contextEntityId: 'attached-workflow',
      }
      await h.agent.generate('Search documentation', h.options)
      expect(m.route).toHaveBeenCalledExactlyOnceWith(
        'search_documentation',
        { query: 'workflow documentation' },
        expect.objectContaining({ userId: 'actor' })
      )
      expect(m.route.mock.calls[0][2].workspaceId).toBe(workspaceId ?? undefined)
      expect(m.route.mock.calls[0][2]).not.toHaveProperty('contextEntityId')
      expect(h.execution.run.scope.workspaceId).toBe(workspaceId)
    }
  )

  it('executes a real registered read schema through the local router and validates its result', async () => {
    m.model = model('list_workflows', { workspaceId: 'workspace' })
    m.route.mockResolvedValueOnce({
      entityKind: 'workflow',
      entities: [{ entityId: 'workflow', entityName: 'Known' }],
      count: 1,
    })
    const h = harness()

    const result = await h.agent.generate('List workflows', h.options)
    expect(result.text).toBe('Done')
    expect(m.route).toHaveBeenCalledExactlyOnceWith(
      'list_workflows',
      { workspaceId: 'workspace' },
      expect.objectContaining({
        userId: 'actor',
        workspaceId: 'workspace',
        accessLevel: 'full',
      })
    )
    expect(await h.agent.getModel({ requestContext: h.options.requestContext })).toMatchObject({
      modelId: 'mock-model-id',
      provider: 'mock-provider',
    })
    expect(m.business).toHaveBeenLastCalledWith(
      h.execution.run.scope,
      expect.objectContaining({ originalArgs: { workspaceId: 'workspace' } }),
      expect.objectContaining({ entityKind: 'workflow' }),
      expect.any(Object)
    )
  })

  it('preserves limited approval followed by a preview and explicit acceptance', async () => {
    const args = { entityId: 'workflow', name: 'New name' }
    const preview = {
      requiresReview: true,
      reviewBaseStateHash: 'baseline',
      success: true,
    }
    const accepted = {
      success: true,
      workspaceId: 'workspace',
      entityKind: 'workflow',
      entityId: 'workflow',
      entityName: 'New name',
    }
    m.model = model('rename_workflow', args)
    m.route.mockResolvedValueOnce(preview)
    m.route.mockResolvedValueOnce(accepted)
    const h = harness('limited')

    expect((await h.agent.generate('Rename workflow', h.options)).finishReason).toBe('suspended')
    expect(m.route).not.toHaveBeenCalled()
    expect(
      (await h.agent.listSuspendedRuns({ threadId: h.execution.run.threadId })).runs[0].toolCalls[0]
        .requiresApproval
    ).toBe(true)
    m.model = model()
    h.execution.model = m.model
    expect(
      (await h.agent.approveToolCallGenerate({ ...h.options, toolCallId: 'business-call' }))
        .finishReason
    ).toBe('suspended')
    expect(m.route).toHaveBeenCalledOnce()
    expect(m.route).toHaveBeenCalledOnce()
    const pending: Pending = {
      target: {
        threadId: h.execution.run.threadId,
        resourceId: nativeConversationIdentity(h.execution.run.scope).resourceId,
        runId: h.execution.run.runId,
        toolCallId: 'business-call',
        toolName: 'rename_workflow',
      },
      stage: 'result',
      originalArgs: args,
      reviewBaseStateHash: 'baseline',
      preview,
    }
    h.execution.pending = pending
    h.execution.decision = { action: 'review.accept' }
    const result = await h.agent.resumeGenerate({}, { ...h.options, toolCallId: 'business-call' })
    expect(result.text).toBe('Done')
    expect(m.route).toHaveBeenLastCalledWith(
      'rename_workflow',
      args,
      expect.objectContaining({
        userId: 'actor',
        acceptedReviewBaseStateHash: 'baseline',
        accessLevel: 'full',
      })
    )
    expect(m.route).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])(
    'preserves dictionaries in actual OpenAI requests and validates arguments before dispatch (valid: %s)',
    async (valid) => {
      const args = {
        url: 'https://example.com',
        method: 'GET',
        headers: { 'x-value': valid ? 'kept' : 7 },
      }
      const requests: any[] = []
      vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.openai.com/v1/responses')
        const body = JSON.parse(String(init?.body))
        requests.push(body)
        return Response.json({
          id: `resp_${requests.length}`,
          object: 'response',
          created_at: 0,
          model: body.model,
          status: 'completed',
          output:
            requests.length === 1
              ? [
                  {
                    id: 'call',
                    type: 'function_call',
                    call_id: 'business-call',
                    name: 'make_api_request',
                    arguments: JSON.stringify(args),
                    status: 'completed',
                  },
                ]
              : [
                  {
                    id: 'answer',
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: 'Done', annotations: [] }],
                  },
                ],
          usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
        })
      })
      m.model = new ModelRouterLanguageModel({
        providerId: 'openai',
        modelId: 'gpt-4.1',
        apiKey: 'fixture-key',
      })
      m.route.mockResolvedValue({ status: 200, data: 'Read' })
      const h = harness()
      const result = await h.agent.generate('Send a request', h.options)
      expect(result.text).toBe('Done')
      expect(requests).toHaveLength(2)
      const tool = (name: string) => requests[0].tools.find((item: any) => item.name === name)
      expect(tool('make_api_request').strict).toBe(false)
      expect(tool('make_api_request').parameters.properties.headers.additionalProperties).toEqual({
        type: 'string',
      })
      expect(tool('edit_workflow_block').parameters.properties.subBlocks).toMatchObject({
        type: 'object',
        additionalProperties: {},
      })
      expect(tool('edit_widget').parameters.properties.params).toMatchObject({
        type: 'object',
        additionalProperties: {},
      })
      expect(
        tool('set_environment_variables').parameters.properties.variables.additionalProperties
      ).toEqual({ type: 'string' })
      if (valid) {
        expect(m.route).toHaveBeenCalledExactlyOnceWith(
          'make_api_request',
          args,
          expect.objectContaining({ workspaceId: 'workspace', userId: 'actor' })
        )
        expect(m.effect).toHaveBeenCalledOnce()
      } else {
        expect(m.route).not.toHaveBeenCalled()
        expect(m.effect).not.toHaveBeenCalled()
      }
    }
  )

  it.each(
    [
      'read_environment_variables',
      'set_environment_variables',
      'read_oauth_credentials',
      'read_credentials',
    ].flatMap((name) =>
      [
        { scope: 'personal', valid: true },
        { scope: 'workspace', workspaceId: 'workspace', valid: true },
        { scope: 'workspace', valid: false },
        { scope: 'personal', workspaceId: 'workspace', valid: false },
        { scope: 'workspace', workspaceId: ' ', valid: false },
      ].map(({ valid, ...args }) => ({
        name,
        valid,
        args: {
          ...args,
          ...(name === 'set_environment_variables' ? { variables: { TOKEN: 'value' } } : {}),
        },
      }))
    )
  )(
    'registers native Anthropic object tools and validates $name $args',
    async ({ name, valid, args }) => {
      const requests: any[] = []
      vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
        const body = JSON.parse(String(init?.body))
        requests.push(body)
        return Response.json({
          id: `message_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content:
            requests.length === 1
              ? [{ type: 'tool_use', id: 'business-call', name, input: args }]
              : [{ type: 'text', text: 'Done' }],
          stop_reason: requests.length === 1 ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 3, output_tokens: 1 },
        })
      })
      m.model = new ModelRouterLanguageModel({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        apiKey: 'fixture-key',
      })
      m.route.mockResolvedValue({
        success: true,
        scope: args.scope,
        variableNames: ['TOKEN'],
        personalVariableNames: [],
        workspaceVariableNames: [],
        conflicts: [],
        count: 1,
        credentials: [],
        oauth: { connected: { credentials: [], total: 0 } },
        environment: { variableNames: ['TOKEN'], count: 1 },
      })
      const h = harness()
      const result = await h.agent.generate('Read or update the selected scope', h.options)
      expect(result.text).toBe('Done')
      expect(requests).toHaveLength(2)
      for (const tool of requests[0].tools) {
        expect(tool.input_schema.type, tool.name).toBe('object')
        expect(tool.input_schema, tool.name).not.toHaveProperty('oneOf')
      }
      const setter = requests[0].tools.find(
        (tool: any) => tool.name === 'set_environment_variables'
      )
      expect(setter.input_schema.properties.variables).toMatchObject({
        type: 'object',
        additionalProperties: { type: 'string' },
      })
      if (valid) {
        expect(m.route).toHaveBeenCalledExactlyOnceWith(name, args, expect.any(Object))
        expect(m.effect).toHaveBeenCalledOnce()
      } else {
        expect(m.route).not.toHaveBeenCalled()
        expect(m.effect).not.toHaveBeenCalled()
        expect(m.business).not.toHaveBeenCalled()
      }
    }
  )

  it('rechecks workspace access after approval before dispatch', async () => {
    m.model = model('rename_workflow', { entityId: 'workflow', name: 'New name' })
    const h = harness('limited')

    expect((await h.agent.generate('Rename workflow', h.options)).finishReason).toBe('suspended')
    m.authorize.mockRejectedValueOnce(new Error('Workspace access revoked'))
    m.model = model()
    h.execution.model = m.model
    await h.agent.approveToolCallGenerate({ ...h.options, toolCallId: 'business-call' })
    expect(m.route).not.toHaveBeenCalled()
    expect(m.effect).not.toHaveBeenCalled()
  })
})
