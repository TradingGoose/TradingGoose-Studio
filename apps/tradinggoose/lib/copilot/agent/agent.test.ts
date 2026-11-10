/** @vitest-environment node */
import { randomUUID } from 'node:crypto'
import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore } from '@mastra/core/storage'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import type { ServerPending as Pending } from '@/lib/copilot/native/target'
import { createCopilotAgent } from './agent'
import { bindCopilotExecution, type CopilotExecution } from './context'

const m = vi.hoisted(() => ({
  model: undefined as any,
  route: vi.fn(),
  stage: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  authorize: vi.fn(),
  business: vi.fn(),
  financial: vi.fn(),
  active: vi.fn(),
  save: vi.fn(),
  effect: vi.fn(),
  selected: vi.fn(),
}))
vi.mock('@/lib/mastra/connections', () => ({
  createConfiguredLanguageModel: (model: string) => {
    m.selected(model)
    return m.model
  },
}))
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: m.financial }))
vi.mock('@/lib/copilot/native/target', async () => ({
  ...(await import('@/lib/copilot/native/errors')),
  authorizeNativeConversationScope: m.authorize,
  copyNativeFinancialSource: (_from: unknown, to: unknown) => to,
  verifyCopilotPendingSource: async (_scope: unknown, pending: unknown) => pending,
}))
vi.mock('@/lib/copilot/native/business-access', () => ({
  authorizeNativeBusinessResult: m.business,
}))
vi.mock('@/lib/copilot/tools/server/base-tool', () => ({
  hashServerToolReviewBase: () => 'review-binding',
}))
vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: m.route }))
vi.mock('@/lib/copilot/tools/server/review-acceptance', () => ({
  stageServerManagedToolReview: m.stage,
  acceptServerManagedToolReview: m.accept,
  rejectServerManagedToolReview: m.reject,
}))
vi.mock('./state', () => ({
  assertCopilotRunActive: m.active,
  saveCopilotOccurrence: m.save,
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
  const execution: CopilotExecution = {
    run: {
      runId,
      threadId: `thread:${runId}`,
      scope,
      model: 'configured/model',
      accessLevel,
      binding: {
        namespace: 'workspace:workspace',
        key: 'binding',
        fingerprint: 'trusted',
        runId,
        actorUserId: 'actor',
        workspaceId: 'workspace',
        workflowId: null,
        purpose: 'copilot',
      },
    },
    finance: {
      getLastOccurrence: () => ({ runId, stepNumber: 0, retryCount: 0 }),
    } as CopilotExecution['finance'],
    signal: new AbortController().signal,
  }
  const binding = bindCopilotExecution(execution)
  const options = {
    runId,
    requestContext: binding.requestContext,
    memory: {
      thread: execution.run.threadId,
      resource: nativeConversationIdentity(scope).resourceId,
    },
    maxSteps: 2,
  }
  return { agent, execution, options, close: binding.close }
}
beforeEach(() => {
  vi.clearAllMocks()
  m.authorize.mockResolvedValue({ actorUserId: 'actor', workspaceId: 'workspace' })
  m.business.mockResolvedValue(undefined)
  m.financial.mockResolvedValue({ appliedUsd: '0' })
  m.active.mockResolvedValue(undefined)
  m.save.mockResolvedValue(undefined)
  m.effect.mockImplementation(async (_run, _call, _phase, _input, execute) => execute())
  m.stage.mockImplementation(async (_name, _args, result) => result)
})
describe('Studio-owned Copilot tools', () => {
  it('executes a real registered read schema through the local router and validates its result', async () => {
    m.model = model('list_workflows', { workspaceId: 'workspace' })
    m.route.mockResolvedValueOnce({
      entityKind: 'workflow',
      entities: [{ entityId: 'workflow', entityName: 'Known' }],
      count: 1,
    })
    const h = harness()
    try {
      const result = await h.agent.generate('List workflows', h.options)
      expect(result.text).toBe('Done')
      expect(m.route).toHaveBeenCalledExactlyOnceWith(
        'list_workflows',
        { workspaceId: 'workspace' },
        expect.objectContaining({
          userId: 'actor',
          workspaceId: 'workspace',
          accessLevel: 'full',
          nativeReviewBinding: 'review-binding',
        })
      )
      expect(m.selected).toHaveBeenCalledWith('configured/model')
      expect(m.financial).toHaveBeenCalledWith(h.execution.run.binding, {
        runId: h.execution.run.runId,
        stepNumber: 0,
        retryCount: 0,
      })
      expect(m.business).toHaveBeenLastCalledWith(
        h.execution.run.scope,
        expect.objectContaining({ originalArgs: { workspaceId: 'workspace' } }),
        expect.objectContaining({ entityKind: 'workflow' }),
        expect.any(Object)
      )
    } finally {
      h.close()
    }
  })

  it('preserves limited approval followed by a preview and explicit acceptance', async () => {
    const args = { entityId: 'workflow', name: 'New name' }
    const preview = {
      requiresReview: true,
      reviewToken: 'preview-token',
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
    m.accept.mockResolvedValueOnce(accepted)
    const h = harness('limited')
    try {
      expect((await h.agent.generate('Rename workflow', h.options)).finishReason).toBe('suspended')
      expect(m.route).not.toHaveBeenCalled()
      expect(
        (await h.agent.listSuspendedRuns({ threadId: h.execution.run.threadId })).runs[0]
          .toolCalls[0].requiresApproval
      ).toBe(true)
      m.model = model()
      expect(
        (await h.agent.approveToolCallGenerate({ ...h.options, toolCallId: 'business-call' }))
          .finishReason
      ).toBe('suspended')
      expect(m.route).toHaveBeenCalledOnce()
      expect(m.accept).not.toHaveBeenCalled()
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
        financialBinding: h.execution.run.binding,
        financialOccurrence: { runId: h.execution.run.runId, stepNumber: 0, retryCount: 0 },
        preview,
      }
      h.execution.pending = pending
      h.execution.decision = { action: 'review.accept', reviewToken: 'preview-token' }
      const result = await h.agent.resumeGenerate({}, { ...h.options, toolCallId: 'business-call' })
      expect(result.text).toBe('Done')
      expect(m.accept).toHaveBeenCalledExactlyOnceWith(
        'rename_workflow',
        'preview-token',
        expect.objectContaining({ userId: 'actor', nativeReviewBinding: 'review-binding' })
      )
      expect(m.route).toHaveBeenCalledOnce()
    } finally {
      h.close()
    }
  })

  it('validates canonical tool arguments before dispatch', async () => {
    m.model = model('list_workflows', { entityId: 'wrong surface' })
    const h = harness()
    try {
      await h.agent.generate('List workflows', h.options)
      expect(m.route).not.toHaveBeenCalled()
      expect(m.effect).not.toHaveBeenCalled()
    } finally {
      h.close()
    }
  })

  it('rechecks workspace access after approval before dispatch', async () => {
    m.model = model('rename_workflow', { entityId: 'workflow', name: 'New name' })
    const h = harness('limited')
    try {
      expect((await h.agent.generate('Rename workflow', h.options)).finishReason).toBe('suspended')
      m.authorize.mockRejectedValueOnce(new Error('Workspace access revoked'))
      m.model = model()
      await h.agent.approveToolCallGenerate({ ...h.options, toolCallId: 'business-call' })
      expect(m.route).not.toHaveBeenCalled()
      expect(m.effect).not.toHaveBeenCalled()
    } finally {
      h.close()
    }
  })
})
