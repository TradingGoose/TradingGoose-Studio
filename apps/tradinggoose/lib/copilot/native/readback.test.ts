import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResultSchemas } from '@/lib/copilot/registry'
import type { JsonObject, Scope } from './contract'
import { nativeToolCallId } from './identity'
import type { ServerPending as Pending } from './target'

const m = vi.hoisted(() => ({
  rows: vi.fn(),
  credential: vi.fn(),
  executionResult: vi.fn(),
  deployment: vi.fn(),
  workspace: vi.fn(),
  deploymentKey: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: m.rows }) }) }) },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: m.workspace }))
vi.mock('@/lib/api-key/service', () => ({ resolveApiKeyForDeployment: m.deploymentKey }))
vi.mock('./business-access', async (original) => ({
  ...(await original<typeof import('./business-access')>()),
  authorizeNativeCredential: m.credential,
}))
vi.mock('@/lib/execution/workflow-execution-events', async (original) => ({
  ...(await original<typeof import('@/lib/execution/workflow-execution-events')>()),
  createWorkflowExecutionResultFromLog: m.executionResult,
}))
vi.mock('@/lib/copilot/tools/server/workflow/check-deployment-status', () => ({
  checkDeploymentStatusServerTool: { execute: m.deployment },
}))

import { readbackNativeToolResult } from './readback'

const scope: Scope = { actorUserId: 'member', workspaceId: null }
function pending(
  name = 'run_workflow',
  args: JsonObject = { entityId: 'workflow', triggerBlockId: 'trigger' }
): Pending {
  return {
    target: {
      toolName: name,
      toolCallId: 'original-execution',
      threadId: 'thread',
      runId: 'native-run',
      resourceId: 'resource',
    },
    originalArgs: args,
    stage: 'result',
  }
}
function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'original-log',
    executionId: nativeToolCallId(pending().target),
    workflowId: 'workflow',
    workspaceId: 'entity-workspace',
    executionData: { environment: { userId: 'member', workspaceId: 'entity-workspace' } },
    endedAt: new Date('2026-11-09T00:00:00.000Z'),
    ...overrides,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  m.rows.mockResolvedValue([logRow()])
  m.credential.mockReset().mockResolvedValue({
    credentialId: 'actual-credential',
    workspaceId: 'selected-workspace',
  })
  m.workspace.mockReset().mockResolvedValue({ hasAccess: true, canWrite: false })
  m.executionResult.mockReturnValue({
    status: 'completed',
    result: { success: true, output: { value: 42 } },
    failureReason: null,
  })
  m.deployment.mockResolvedValue({
    apiDeployed: true,
    chatDeployed: false,
    isDeployed: true,
    deployedAt: '2026-11-08T00:00:00.000Z',
  })
  m.deploymentKey
    .mockReset()
    .mockResolvedValue({ id: 'key', name: 'Selected key', type: 'personal' })
})
describe('authoritative native result readback', () => {
  it('reads the original self-contained execution result after fresh authorization', async () => {
    expect(await readbackNativeToolResult(scope, pending(), { userId: 'member' })).toEqual({
      executionId: nativeToolCallId(pending().target),
      message: 'Workflow execution completed',
      data: { success: true, output: { value: 42 } },
    })
    expect(m.executionResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ executionId: nativeToolCallId(pending().target) })
    )
  })
  it.each([null, 'entity-workspace', 'conversation-workspace'])(
    'reads an independently authorized execution from conversation %j without rewriting its scope',
    async (workspaceId) => {
      const conversation = { ...scope, workspaceId }
      const original = pending()
      const before = structuredClone(original)
      await expect(
        readbackNativeToolResult(conversation, original, { userId: 'member' })
      ).resolves.toMatchObject({ executionId: nativeToolCallId(pending().target) })
      expect(m.workspace).toHaveBeenCalledWith('entity-workspace', 'member')
      expect(original).toEqual(before)
      expect(conversation.workspaceId).toBe(workspaceId)
    }
  )
  it('refuses revoked original execution workspace before reading canonical payload', async () => {
    m.workspace.mockResolvedValue({ hasAccess: false })
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member' })
    ).rejects.toMatchObject({ status: 403 })
    expect(m.executionResult).not.toHaveBeenCalled()
  })
  it.each([null, ''])(
    'refuses absent or empty original execution workspace %j',
    async (workspaceId) => {
      m.rows.mockResolvedValue([logRow({ workspaceId })])
      await expect(
        readbackNativeToolResult(scope, pending(), { userId: 'member' })
      ).rejects.toMatchObject({ status: 403 })
      expect(m.workspace).not.toHaveBeenCalled()
      expect(m.executionResult).not.toHaveBeenCalled()
    }
  )
  it.each([
    { workspaceId: 'foreign-workspace' },
    { executionData: { environment: { userId: 'other-member', workspaceId: 'entity-workspace' } } },
    { executionData: { environment: { userId: null, workspaceId: 'entity-workspace' } } },
    { executionData: { environment: { userId: 'member' } } },
    { executionData: {} },
  ])('refuses conflicting terminal log provenance %j before payload access', async (overrides) => {
    m.rows.mockResolvedValue([logRow(overrides)])
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member' })
    ).rejects.toMatchObject({ status: 403 })
    expect(m.executionResult).not.toHaveBeenCalled()
  })
  it('preserves supplied business-workspace conflict refusal', async () => {
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member', workspaceId: 'foreign' })
    ).rejects.toMatchObject({ status: 403 })
    expect(m.executionResult).not.toHaveBeenCalled()
  })
  it('checks cancellation before loading the log and before projecting the result', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(m.rows).not.toHaveBeenCalled()
    const active = new AbortController()
    m.rows.mockImplementationOnce(async () => {
      active.abort()
      return [logRow()]
    })
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member', signal: active.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('does not invent terminal output for pending, paused or unavailable logs', async () => {
    m.rows.mockResolvedValueOnce([{ endedAt: null }])
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member' })
    ).rejects.toMatchObject({ status: 409 })
  })
  it.each([undefined, 'selected-workspace'])(
    'returns the authorized credential workspace independently of personal billing (%j)',
    async (workspaceId) => {
      expect(
        ToolResultSchemas.gdrive_request_access.parse(
          await readbackNativeToolResult(
            scope,
            pending('gdrive_request_access', {}),
            { userId: 'member', workspaceId },
            { credentialId: 'actual-credential' }
          )
        )
      ).toEqual({
        granted: true,
        credentialId: 'actual-credential',
        workspaceId: 'selected-workspace',
      })
      expect(scope.workspaceId).toBeNull()
      expect(m.credential).toHaveBeenCalledWith(scope, 'actual-credential', workspaceId)
      m.credential.mockRejectedValueOnce(new Error('Revoked'))
      await expect(
        readbackNativeToolResult(
          scope,
          pending('gdrive_request_access', {}),
          { userId: 'member' },
          { credentialId: 'forged' }
        )
      ).rejects.toThrow('Revoked')
    }
  )
  it('reads actual deployment postcondition without deploying or fabricating endpoints', async () => {
    expect(
      await readbackNativeToolResult(
        scope,
        pending('deploy_workflow', {
          entityId: 'workflow',
          action: 'deploy',
          deployType: 'api',
        }),
        { userId: 'member' }
      )
    ).toEqual({
      action: 'deploy',
      deployType: 'api',
      isDeployed: true,
      deployedAt: '2026-11-08T00:00:00.000Z',
    })
    await expect(
      readbackNativeToolResult(
        scope,
        pending('deploy_workflow', {
          entityId: 'workflow',
          action: 'undeploy',
          deployType: 'api',
        }),
        { userId: 'member' }
      )
    ).rejects.toMatchObject({ status: 409 })
  })
  it.each([false, true])(
    'settles a missing deployment key even when already deployed=%s',
    async (apiDeployed) => {
      m.rows.mockResolvedValue([{ workspaceId: 'workflow-workspace', pinnedApiKeyId: 'expired' }])
      m.deployment.mockResolvedValue({ apiDeployed, isDeployed: apiDeployed })
      m.deploymentKey.mockResolvedValue(null)
      const result = await readbackNativeToolResult(
        scope,
        pending('deploy_workflow', { entityId: 'workflow', action: 'deploy', deployType: 'api' }),
        { userId: 'member' }
      )
      expect(ToolResultSchemas.deploy_workflow.parse(result)).toMatchObject({
        needsApiKey: true,
        message: expect.stringContaining('Select a valid API key'),
      })
      expect(result).not.toHaveProperty('isDeployed')
      expect(m.deploymentKey).toHaveBeenCalledExactlyOnceWith(
        'expired',
        'member',
        'workflow-workspace'
      )
    }
  )
  it('unsupported result recovery never reexecutes an effect', async () => {
    await expect(
      readbackNativeToolResult(scope, pending('create_workflow'), { userId: 'member' })
    ).rejects.toThrow('must not be repeated')
    expect(m.executionResult).not.toHaveBeenCalled()
    expect(m.deployment).not.toHaveBeenCalled()
  })
})
