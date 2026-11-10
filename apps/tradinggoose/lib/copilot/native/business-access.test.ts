import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JsonObject, Scope } from './contract'
import type { ServerPending as Pending } from './target'

const m = vi.hoisted(() => ({
  rows: vi.fn(),
  workspace: vi.fn(),
  entity: vi.fn(),
  credentials: vi.fn(),
  monitor: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: m.rows }) }) }) },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: m.workspace }))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  verifySavedEntityContext: m.entity,
}))
vi.mock('@/lib/credentials/oauth', () => ({ resolveOAuthCredentialAccountForUser: m.credentials }))
vi.mock('@/app/api/monitors/shared', () => ({ getMonitorRowById: m.monitor }))

import { authorizeNativeBusinessResult, authorizeNativeCredential } from './business-access'

const scope: Scope = { actorUserId: 'actor', workspaceId: null }
function pending(toolName: string, args: JsonObject): Pending {
  return {
    target: {
      toolName,
      toolCallId: 'call',
      threadId: 'thread',
      runId: 'run',
      resourceId: 'resource',
    },
    originalArgs: args,
    stage: 'result',
    financialBinding: {
      namespace: 'billing',
      key: 'key',
      fingerprint: 'fp',
      actorUserId: 'actor',
      workspaceId: null,
      workflowId: null,
      runId: 'run',
      purpose: 'copilot',
    },
    financialOccurrence: { stepNumber: 1, retryCount: 0 },
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  m.workspace.mockResolvedValue({ hasAccess: true })
  m.rows.mockResolvedValue([{ workspaceId: 'entity-workspace' }])
  m.credentials.mockResolvedValue({
    credentialId: 'credential',
    workspaceId: 'entity-workspace',
    providerId: 'google-drive',
  })
  m.monitor.mockResolvedValue({ workflow: { workspaceId: 'monitor-workspace' } })
})
describe('native result fresh business access', () => {
  it('keeps personal conversation null while rechecking separate entity and created entity', async () => {
    await authorizeNativeBusinessResult(
      scope,
      pending('create_workflow', { workspaceId: 'entity-workspace', name: 'Name' }),
      { entityId: 'created', workspaceId: 'entity-workspace' }
    )
    expect(m.workspace).toHaveBeenCalledWith('entity-workspace', 'actor')
    expect(m.entity).toHaveBeenCalledWith({ userId: 'actor' }, 'workflow', 'created', 'read')
  })
  it('denies revoked entity/workspace before result handoff', async () => {
    m.entity.mockRejectedValueOnce(new Error('Revoked'))
    await expect(
      authorizeNativeBusinessResult(scope, pending('read_workflow', { entityId: 'private' }))
    ).rejects.toThrow('Revoked')
    m.workspace.mockResolvedValue({ hasAccess: false })
    await expect(
      authorizeNativeBusinessResult(scope, pending('list_workflows', { workspaceId: 'denied' }))
    ).rejects.toMatchObject({ status: 403 })
  })
  it('rechecks selected credential membership/provider using stored workspace, never owner fallback', async () => {
    await authorizeNativeCredential(scope, 'credential', 'entity-workspace')
    expect(m.credentials).toHaveBeenCalledWith({
      userId: 'actor',
      workspaceId: 'entity-workspace',
      credentialId: 'credential',
    })
    m.credentials.mockResolvedValue(null)
    await expect(authorizeNativeCredential(scope, 'credential')).rejects.toMatchObject({
      status: 403,
    })
  })
  it('keeps both personal and workspace conversation scopes independent of separately authorized business workspace', async () => {
    await authorizeNativeCredential(scope, 'credential', 'entity-workspace')
    await authorizeNativeCredential(
      { ...scope, workspaceId: 'different-conversation-workspace' },
      'credential',
      'entity-workspace'
    )
    expect(m.credentials).toHaveBeenLastCalledWith({
      userId: 'actor',
      workspaceId: 'entity-workspace',
      credentialId: 'credential',
    })
    await authorizeNativeCredential(
      { ...scope, workspaceId: 'different-conversation-workspace' },
      'credential'
    )
    expect(m.credentials).toHaveBeenLastCalledWith({ userId: 'actor', credentialId: 'credential' })
  })
  it('checks monitor actual workflow workspace without external monitor provider contact', async () => {
    await authorizeNativeBusinessResult(scope, pending('read_monitor', { monitorId: 'monitor' }))
    expect(m.monitor).toHaveBeenCalledWith('monitor')
    expect(m.workspace).toHaveBeenCalledWith('monitor-workspace', 'actor')
    expect(m.entity).not.toHaveBeenCalled()
  })
  it('log ID uses retained log workspace while workflow ID uses canonical workflow authorization', async () => {
    await authorizeNativeBusinessResult(scope, pending('read_workflow_logs', { entityId: 'log' }))
    expect(m.workspace).toHaveBeenCalledWith('entity-workspace', 'actor')
    expect(m.entity).not.toHaveBeenCalled()
    m.rows.mockResolvedValue([])
    await authorizeNativeBusinessResult(
      scope,
      pending('read_workflow_logs', { entityId: 'workflow' })
    )
    expect(m.entity).toHaveBeenCalledWith({ userId: 'actor' }, 'workflow', 'workflow', 'read')
  })
})
