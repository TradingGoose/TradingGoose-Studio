import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingExecutionTransaction } from '@/lib/execution/pending-execution'
import { nativeToolCallId } from './identity'
import type { ServerPending as Pending } from './target'

const m = vi.hoisted(() => ({
  scope: vi.fn(),
  pending: vi.fn(),
  access: vi.fn(),
  active: vi.fn(),
  claim: vi.fn(),
  claimAdmission: vi.fn(),
  run: vi.fn(),
  model: vi.fn(),
}))
vi.mock('@/lib/copilot/agent/context', () => ({ readCopilotRun: m.run }))
vi.mock('@/lib/copilot/settings.server', () => ({ resolveCopilotModel: m.model }))
vi.mock('@/lib/copilot/agent/receipts', () => ({
  assertCopilotRunActive: m.active,
  claimCopilotEffect: m.claim,
  claimCopilotWorkflowAdmission: m.claimAdmission,
}))
vi.mock('./target', () => ({
  authorizeNativeConversationScope: m.scope,
  resolveNativePendingTarget: m.pending,
}))
vi.mock('./business-access', () => ({ authorizeNativeBusinessResult: m.access }))
vi.unmock('@/blocks/registry')

import {
  authorizeNativeWorkflowDeploymentEffect,
  authorizeNativeWorkflowQueueEffect,
} from './workflow-effects'

const scope = { actorUserId: 'member', workspaceId: null }
const target = {
  threadId: 'thread',
  resourceId: 'resource',
  runId: 'run',
  toolCallId: 'call',
  toolName: 'run_workflow',
}
const run = {
  threadId: target.threadId,
  runId: target.runId,
  scope,
  model: 'openai/original-admin-model',
  accessLevel: 'limited',
}
function pending(): Pending {
  return {
    target,
    originalArgs: {
      entityId: 'workflow',
      triggerBlockId: 'trigger',
      workflow_input: { symbol: 'AAPL' },
    },
    stage: 'result',
  }
}
function body() {
  return {
    native: { workspaceId: null, target },
    executionId: nativeToolCallId(target),
    executionTarget: 'live',
    triggerType: 'manual',
    triggerBlockId: 'trigger',
    input: { symbol: 'AAPL' },
    workflowData: {
      blocks: { trigger: { type: 'manual_trigger', subBlocks: {} }, output: { type: 'response' } },
      edges: [{ source: 'trigger', target: 'output' }],
      loops: {},
      parallels: {},
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  m.active.mockReset().mockResolvedValue(undefined)
  m.claim.mockReset().mockResolvedValue(undefined)
  m.claimAdmission.mockReset().mockResolvedValue(undefined)
  m.scope.mockResolvedValue(scope)
  m.pending.mockImplementation(async () => pending())
  m.run.mockReset().mockResolvedValue(run)
  m.model.mockReset().mockResolvedValue({ model: run.model, apiKey: 'admin-key' })
})
describe('native business effect admission', () => {
  it('requires native context before admitting Copilot effects', async () => {
    await expect(authorizeNativeWorkflowQueueEffect('member', 'workflow', {})).rejects.toThrow()
    await expect(
      authorizeNativeWorkflowDeploymentEffect('member', 'workflow', undefined, 'deploy')
    ).rejects.toThrow()
    expect(m.pending).not.toHaveBeenCalled()
    expect(m.model).not.toHaveBeenCalled()
  })
  it('checks actual actor, original target/financial result stage and canonical trigger before enqueue', async () => {
    const afterInsert = await authorizeNativeWorkflowQueueEffect('member', 'workflow', body())
    expect(m.scope).toHaveBeenCalledWith('member', null)
    expect(m.pending).toHaveBeenCalledWith(scope, target, 'result', undefined)
    expect(m.access).toHaveBeenCalledWith(scope, pending())
    expect(m.active).toHaveBeenCalledWith(target.runId)
    expect(m.run).toHaveBeenCalledWith(scope, target.threadId, target.runId)
    expect(m.model).toHaveBeenCalledWith(run.model)
    expect(m.claimAdmission).not.toHaveBeenCalled()
    const transaction = {} as PendingExecutionTransaction
    await afterInsert(transaction)
    expect(m.claimAdmission).toHaveBeenCalledExactlyOnceWith(run, target.toolCallId, transaction)
  })
  it.each([
    { executionId: 'other' },
    { executionId: target.toolCallId },
    { triggerBlockId: 'other' },
    { executionTarget: 'deployed' },
    { input: { symbol: 'MSFT' } },
    { triggerType: 'chat' },
  ])('denies changed execution request %j before business access', async (delta) => {
    await expect(
      authorizeNativeWorkflowQueueEffect('member', 'workflow', { ...body(), ...delta })
    ).rejects.toMatchObject({ status: 403 })
    expect(m.access).not.toHaveBeenCalled()
  })
  it('denies another workflow and wrong native tool/stage/financial acceptance', async () => {
    await expect(
      authorizeNativeWorkflowQueueEffect('member', 'foreign', body())
    ).rejects.toMatchObject({ status: 403 })
    m.pending.mockResolvedValueOnce({
      ...pending(),
      target: { ...target, toolName: 'deploy_workflow' },
    })
    await expect(
      authorizeNativeWorkflowQueueEffect('member', 'workflow', body())
    ).rejects.toMatchObject({ status: 422 })
    m.pending.mockRejectedValueOnce(new Error('Original finance unavailable'))
    await expect(authorizeNativeWorkflowQueueEffect('member', 'workflow', body())).rejects.toThrow(
      'finance unavailable'
    )
  })
  it('preserves string-input normalization from the existing Copilot workflow caller', async () => {
    m.pending.mockResolvedValueOnce({
      ...pending(),
      originalArgs: { entityId: 'workflow', triggerBlockId: 'trigger', workflow_input: 'hello' },
    })
    await authorizeNativeWorkflowQueueEffect('member', 'workflow', {
      ...body(),
      input: { input: 'hello' },
    })
  })
  it('uses current canonical configured trigger input only when original native input is absent', async () => {
    m.pending.mockResolvedValueOnce({
      ...pending(),
      originalArgs: { entityId: 'workflow', triggerBlockId: 'trigger' },
    })
    const request = body()
    request.workflowData.blocks.trigger.subBlocks = {
      inputFormat: { value: [{ name: 'symbol', value: 'AAPL' }] },
    }
    await authorizeNativeWorkflowQueueEffect('member', 'workflow', request)
  })
  it('deployment validates actual action/entity/type and current authorization before mutation', async () => {
    const deploy = {
      ...pending(),
      target: { ...target, toolName: 'deploy_workflow' },
      originalArgs: { entityId: 'workflow', action: 'deploy', deployType: 'api' },
    }
    m.pending.mockResolvedValue(deploy)
    await authorizeNativeWorkflowDeploymentEffect(
      'member',
      'workflow',
      { workspaceId: null, target: deploy.target },
      'deploy'
    )
    expect(m.access).toHaveBeenCalledWith(scope, deploy)
    expect(m.claim).toHaveBeenCalledExactlyOnceWith(run, target.toolCallId, 'browser')
    await expect(
      authorizeNativeWorkflowDeploymentEffect(
        'member',
        'workflow',
        { workspaceId: null, target: deploy.target },
        'undeploy'
      )
    ).rejects.toMatchObject({ status: 403 })
    m.pending.mockResolvedValue({
      ...deploy,
      originalArgs: { ...deploy.originalArgs, deployType: 'chat' },
    })
    await expect(
      authorizeNativeWorkflowDeploymentEffect(
        'member',
        'workflow',
        { workspaceId: null, target: deploy.target },
        'deploy'
      )
    ).rejects.toMatchObject({ status: 403 })
  })
  it('rejects stale callbacks before any effect claim', async () => {
    m.pending.mockRejectedValueOnce(
      Object.assign(new Error('Stale pending target'), { status: 409 })
    )
    await expect(
      authorizeNativeWorkflowQueueEffect('member', 'workflow', body())
    ).rejects.toMatchObject({ status: 409 })
    expect(m.claimAdmission).not.toHaveBeenCalled()
  })
  it('rejects cancelled runs and duplicate browser dispatch', async () => {
    m.active.mockRejectedValueOnce(Object.assign(new Error('Cancelled run'), { status: 409 }))
    await expect(
      authorizeNativeWorkflowQueueEffect('member', 'workflow', body())
    ).rejects.toMatchObject({ status: 409 })
    expect(m.claimAdmission).not.toHaveBeenCalled()
    m.claimAdmission.mockRejectedValueOnce(
      Object.assign(new Error('Already dispatched'), { status: 409 })
    )
    const afterInsert = await authorizeNativeWorkflowQueueEffect('member', 'workflow', body())
    expect(m.claimAdmission).not.toHaveBeenCalled()
    await expect(afterInsert({} as PendingExecutionTransaction)).rejects.toMatchObject({
      status: 409,
    })
    expect(m.claimAdmission).toHaveBeenCalledOnce()
  })
  it.each([409, 422])(
    'rejects revoked model/key configuration (%i) before queue or deployment claims',
    async (status) => {
      m.model.mockRejectedValue(Object.assign(new Error('Copilot model unavailable'), { status }))
      await expect(
        authorizeNativeWorkflowQueueEffect('member', 'workflow', body())
      ).rejects.toMatchObject({ status })
      const deploy = {
        ...pending(),
        target: { ...target, toolName: 'deploy_workflow' },
        originalArgs: { entityId: 'workflow', action: 'deploy', deployType: 'api' },
      }
      m.pending.mockResolvedValueOnce(deploy)
      await expect(
        authorizeNativeWorkflowDeploymentEffect(
          'member',
          'workflow',
          { workspaceId: null, target: deploy.target },
          'deploy'
        )
      ).rejects.toMatchObject({ status })
      expect(m.claim).not.toHaveBeenCalled()
      expect(m.claimAdmission).not.toHaveBeenCalled()
    }
  )
})
