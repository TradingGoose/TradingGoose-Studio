import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolResultSchemas } from '@/lib/copilot/registry'
import type { JsonObject, Scope } from './contract'
import type { ServerPending as Pending } from './target'

const m = vi.hoisted(() => ({
  rows: vi.fn(),
  access: vi.fn(),
  credential: vi.fn(),
  executionAccess: vi.fn(),
  executionResult: vi.fn(),
  deployment: vi.fn(),
  workspace: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: m.rows }) }) }) },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: m.workspace }))
vi.mock('./business-access', () => ({
  authorizeNativeBusinessResult: m.access,
  authorizeNativeCredential: m.credential,
}))
vi.mock('@/lib/execution/workflow-execution-events', () => ({
  readWorkflowExecutionAccessContext: m.executionAccess,
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
    executionId: 'original-execution',
    workflowId: 'workflow',
    workspaceId: 'entity-workspace',
    executionData: { environment: { userId: 'member' } },
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
  m.executionAccess.mockResolvedValue({ userId: 'member', workspaceId: 'entity-workspace' })
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
})
describe('authoritative native result readback', () => {
  it('reads the original self-contained execution result after fresh authorization', async () => {
    expect(await readbackNativeToolResult(scope, pending(), { userId: 'member' })).toEqual({
      executionId: 'original-execution',
      message: 'Workflow execution completed',
      data: { success: true, output: { value: 42 } },
    })
    expect(m.executionAccess).toHaveBeenCalledWith({
      pendingExecutionId: 'original-execution',
      workflowId: 'workflow',
    })
    expect(m.executionResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ executionId: 'original-execution' })
    )
    expect(m.access).toHaveBeenCalledTimes(2)
  })
  it.each(['other-member', null])(
    'denies execution owned by %j without payload access',
    async (userId) => {
      m.executionAccess.mockResolvedValue({ userId, workspaceId: 'workspace' })
      await expect(
        readbackNativeToolResult(scope, pending(), { userId: 'member' })
      ).rejects.toMatchObject({ status: 403 })
      expect(m.executionResult).not.toHaveBeenCalled()
    }
  )
  it.each([null, 'entity-workspace', 'conversation-workspace'])(
    'reads an independently authorized execution from conversation %j without rewriting its scope',
    async (workspaceId) => {
      const conversation = { ...scope, workspaceId }
      const original = pending()
      const before = structuredClone(original)
      await expect(
        readbackNativeToolResult(conversation, original, { userId: 'member' })
      ).resolves.toMatchObject({ executionId: 'original-execution' })
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
    expect(m.rows).not.toHaveBeenCalled()
    expect(m.executionResult).not.toHaveBeenCalled()
  })
  it.each([null, ''])(
    'refuses absent or empty original execution workspace %j',
    async (workspaceId) => {
      m.executionAccess.mockResolvedValue({ userId: 'member', workspaceId })
      await expect(
        readbackNativeToolResult(scope, pending(), { userId: 'member' })
      ).rejects.toMatchObject({ status: 403 })
      expect(m.workspace).not.toHaveBeenCalled()
      expect(m.executionResult).not.toHaveBeenCalled()
    }
  )
  it.each([
    { workspaceId: 'foreign-workspace' },
    { executionId: 'foreign-execution' },
    { workflowId: 'foreign-workflow' },
    { executionData: { environment: { userId: 'other-member' } } },
    { executionData: { environment: { userId: null } } },
    { executionData: {} },
  ])('refuses conflicting terminal log provenance %j before payload access', async (overrides) => {
    m.rows.mockResolvedValue([logRow(overrides)])
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member' })
    ).rejects.toMatchObject({ status: 403 })
    expect(m.executionResult).not.toHaveBeenCalled()
  })
  it('rechecks workspace read permission through the final authorization check', async () => {
    m.workspace.mockResolvedValueOnce({ hasAccess: true }).mockResolvedValue({ hasAccess: false })
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member' })
    ).rejects.toMatchObject({ status: 403 })
    expect(m.workspace).toHaveBeenCalledTimes(2)
  })
  it.each([
    { userId: 'other-member', workspaceId: 'entity-workspace' },
    { userId: 'member', workspaceId: 'changed-workspace' },
  ])('refuses access provenance drift before projecting the result %j', async (changedAccess) => {
    m.executionAccess
      .mockResolvedValueOnce({ userId: 'member', workspaceId: 'entity-workspace' })
      .mockResolvedValue(changedAccess)
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member' })
    ).rejects.toMatchObject({ status: 403 })
  })
  it('preserves supplied business-workspace conflict refusal', async () => {
    m.access.mockRejectedValueOnce(new Error('Workflow workspace mismatch'))
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member', workspaceId: 'foreign' })
    ).rejects.toThrow('workspace mismatch')
    expect(m.executionAccess).not.toHaveBeenCalled()
    expect(m.executionResult).not.toHaveBeenCalled()
  })
  it('checks cancellation before execution access and before projecting the result', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      readbackNativeToolResult(scope, pending(), { userId: 'member', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(m.executionAccess).not.toHaveBeenCalled()
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
  it('unsupported result recovery never reexecutes an effect', async () => {
    await expect(
      readbackNativeToolResult(scope, pending('create_workflow'), { userId: 'member' })
    ).rejects.toThrow('must not be repeated')
    expect(m.executionResult).not.toHaveBeenCalled()
    expect(m.deployment).not.toHaveBeenCalled()
  })
})
