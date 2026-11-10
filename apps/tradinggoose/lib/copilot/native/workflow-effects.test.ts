import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pending } from './contract'

const m = vi.hoisted(() => ({ scope: vi.fn(), pending: vi.fn(), access: vi.fn() }))
vi.mock('./target', () => ({
  NativeTargetError: class NativeTargetError extends Error {
    constructor(
      message: string,
      public status = 409
    ) {
      super(message)
    }
  },
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
function pending(): Pending {
  return {
    target,
    originalArgs: {
      entityId: 'workflow',
      triggerBlockId: 'trigger',
      workflow_input: { symbol: 'AAPL' },
    },
    stage: 'result',
    financialBinding: {
      namespace: 'billing',
      key: 'key',
      fingerprint: 'fp',
      actorUserId: 'member',
      workspaceId: null,
      workflowId: null,
      runId: 'run',
      purpose: 'copilot',
    },
    financialOccurrence: { stepNumber: 3, retryCount: 0 },
  }
}
function body() {
  return {
    native: { workspaceId: null, target },
    executionId: 'call',
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
  m.scope.mockResolvedValue(scope)
  m.pending.mockImplementation(async () => pending())
})
describe('native business effect admission', () => {
  it('keeps ordinary explicitly authenticated manual workflows free of invented native context', async () => {
    await authorizeNativeWorkflowQueueEffect('member', 'workflow', {})
    await authorizeNativeWorkflowDeploymentEffect('member', 'workflow', undefined, 'deploy')
    expect(m.pending).not.toHaveBeenCalled()
  })
  it('checks actual actor, original target/financial result stage and canonical trigger before enqueue', async () => {
    await authorizeNativeWorkflowQueueEffect('member', 'workflow', body())
    expect(m.scope).toHaveBeenCalledWith('member', null)
    expect(m.pending).toHaveBeenCalledWith(scope, target, 'result', undefined)
    expect(m.access).toHaveBeenCalledWith(scope, pending())
  })
  it.each([
    { executionId: 'other' },
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
})
