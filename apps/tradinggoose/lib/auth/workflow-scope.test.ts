import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthType } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from './workflow-scope'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), access: vi.fn() }))
vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.rows }) }) }) },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: mocks.access }))
vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: { INTERNAL_JWT: 'internal_jwt', SESSION: 'session', API_KEY: 'api_key' },
}))

beforeEach(() => {
  mocks.rows.mockReset().mockResolvedValue([{ userId: 'owner-1', workspaceId: 'workspace-1' }])
  mocks.access.mockReset().mockResolvedValue({ hasAccess: true, canWrite: true })
})

describe('Authenticated workflow scope', () => {
  it.each([
    [{ success: false }, 'read'],
    [{ success: true, authType: AuthType.INTERNAL_JWT }, 'read'],
    [
      {
        success: true,
        authType: AuthType.INTERNAL_JWT,
        internalWorkflowExecution: {
          source: 'workflow_block',
          parentWorkflowId: 'workflow-1',
          parentBlockId: 'block-1',
        },
      },
      'write',
    ],
  ] as const)('rejects requests without an authenticated principal: %j', async (auth, access) => {
    expect(await authorizeWorkflowScope(auth, 'workflow-1', access)).toMatchObject({
      ok: false,
      status: 401,
    })
    expect(mocks.rows).not.toHaveBeenCalled()
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it('checks the authenticated user, not the supplied workflow owner', async () => {
    expect(
      await authorizeWorkflowScope({ success: true, userId: 'member-1' }, 'workflow-1', 'write')
    ).toEqual({
      ok: true,
      userId: 'member-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
    expect(mocks.access).toHaveBeenCalledWith('workspace-1', 'member-1')
  })

  it('rejects read-only users on writes and cross-workspace access', async () => {
    mocks.access
      .mockResolvedValueOnce({ hasAccess: true, canWrite: false })
      .mockResolvedValueOnce({ hasAccess: false, canWrite: false })
    expect(
      await authorizeWorkflowScope({ success: true, userId: 'reader' }, 'workflow-1', 'write')
    ).toMatchObject({ ok: false, status: 403 })
    expect(
      await authorizeWorkflowScope({ success: true, userId: 'outsider' }, 'workflow-1', 'read')
    ).toMatchObject({ ok: false, status: 403 })
  })

  it('rejects missing workflows', async () => {
    mocks.rows.mockResolvedValue([])
    expect(
      await authorizeWorkflowScope({ success: true, userId: 'user-1' }, 'missing', 'read')
    ).toMatchObject({ ok: false, status: 404 })
  })

  it('binds workspace API keys to their workspace', async () => {
    const auth = {
      success: true,
      userId: 'user-1',
      authType: AuthType.API_KEY,
      apiKeyType: 'workspace' as const,
    }
    expect(
      await authorizeWorkflowScope(
        { ...auth, workspaceId: 'workspace-other' },
        'workflow-1',
        'read'
      )
    ).toMatchObject({ ok: false, status: 403 })
    expect(await authorizeWorkflowScope(auth, 'workflow-1', 'read')).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(mocks.access).not.toHaveBeenCalled()
    expect(
      await authorizeWorkflowScope({ ...auth, workspaceId: 'workspace-1' }, 'workflow-1', 'read')
    ).toMatchObject({ ok: true })
  })

  it('checks workspace membership for personal API keys without requiring a workspace binding', async () => {
    expect(
      await authorizeWorkflowScope(
        { success: true, userId: 'user-1', authType: AuthType.API_KEY, apiKeyType: 'personal' },
        'workflow-1',
        'read'
      )
    ).toMatchObject({ ok: true })
    expect(mocks.access).toHaveBeenCalledWith('workspace-1', 'user-1')
  })
})
