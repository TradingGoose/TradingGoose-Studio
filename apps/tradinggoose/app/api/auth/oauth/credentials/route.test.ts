/** @vitest-environment node */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  access: vi.fn(),
  credentials: vi.fn(),
  connections: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn() },
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  },
}))

vi.mock('@/lib/auth/hybrid', () => ({
  AuthType: { SESSION: 'session', API_KEY: 'api_key', INTERNAL_JWT: 'internal_jwt' },
  checkHybridAuth: mocks.authenticate,
}))
vi.mock('@/lib/credentials/oauth', () => ({
  listOAuthCredentialsForUser: mocks.credentials,
  listOAuthConnectionsForUser: mocks.connections,
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: mocks.access }))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => mocks.logger }))
vi.mock('@tradinggoose/db', () => ({ db: mocks.db }))
vi.mock('@tradinggoose/db/schema', () => ({
  credential: { id: 'id', workspaceId: 'workspaceId', accountId: 'accountId' },
  workflow: { id: 'id', workspaceId: 'workspaceId' },
}))
vi.mock('drizzle-orm', () => ({
  eq: (field: string, value: unknown) => ({ field, value }),
  isNotNull: (field: string) => ({ field, type: 'isNotNull' }),
}))

const credential = {
  id: 'saved',
  accountId: 'account-1',
  provider: 'robinhood',
  name: 'Canonical credential name',
  isDefault: true,
  scopes: ['canonical-scope'],
}
const request = (query: string) =>
  new NextRequest(`http://localhost/api/auth/oauth/credentials?${query}`)

describe('OAuth credentials API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID: () => 'credential-id' })
    mocks.authenticate.mockResolvedValue({ success: true, authType: 'session', userId: 'owner' })
    mocks.access.mockResolvedValue({ hasAccess: true, canWrite: true })
    mocks.credentials.mockResolvedValue([])
    mocks.connections.mockResolvedValue([])
    mocks.db.limit.mockResolvedValue([{ workspaceId: 'workspace-1' }])
  })

  afterEach(() => vi.unstubAllGlobals())

  it('returns canonical credentials and only connections not yet saved in this workspace', async () => {
    mocks.credentials.mockResolvedValue([credential])
    mocks.connections.mockResolvedValue([{ id: 'account-1' }, { id: 'account-2' }])
    const response = await GET(request('provider=robinhood&workspaceId=workspace-1'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      credentials: [credential],
      connections: [{ id: 'account-2' }],
    })
    expect(mocks.connections).toHaveBeenCalledWith({ userId: 'owner', providerIds: ['robinhood'] })
    expect(mocks.db.insert).not.toHaveBeenCalled()
  })

  it('returns empty lists when there are no saved credentials or personal connections', async () => {
    const response = await GET(request('provider=github&workspaceId=workspace-1'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ credentials: [], connections: [] })
  })

  it.each([
    [false, 'provider=google', 401, 'User not authenticated'],
    [true, 'workspaceId=workspace-1', 400, 'Provider or credentialId is required'],
  ])('rejects invalid GET requests: %s/%s', async (success, query, status, error) => {
    mocks.authenticate.mockResolvedValue({ success, authType: 'session', userId: 'owner' })
    const response = await GET(request(query))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error })
    expect(mocks.logger.warn).toHaveBeenCalled()
    expect(mocks.credentials).not.toHaveBeenCalled()
  })

  it('scopes workflow credential lookups to the workflow workspace', async () => {
    mocks.credentials.mockResolvedValue([credential])
    const response = await GET(request('workflowId=workflow-1&credentialId=saved'))
    expect(response.status).toBe(200)
    expect((await response.json()).credentials).toEqual([credential])
    expect(mocks.access).toHaveBeenCalledWith('workspace-1', 'owner')
    expect(mocks.credentials).toHaveBeenCalledWith({
      userId: 'owner',
      workspaceId: 'workspace-1',
      credentialId: 'saved',
      providerIds: undefined,
    })
  })

  it('reports database failures', async () => {
    mocks.credentials.mockRejectedValueOnce(new Error('Database error'))
    const response = await GET(request('provider=google&workspaceId=workspace-1'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error' })
    expect(mocks.logger.error).toHaveBeenCalled()
  })

  it.each(['api_key', 'internal_jwt'])(
    'hides unpublished personal connections from %s',
    async (authType) => {
      mocks.authenticate.mockResolvedValue({
        success: true,
        authType,
        userId: 'owner',
        workspaceId: 'workspace-1',
      })
      mocks.credentials.mockResolvedValue([credential])
      const response = await GET(request('provider=robinhood&workspaceId=workspace-1'))
      expect(await response.json()).toEqual({ credentials: [credential], connections: [] })
      expect(mocks.connections).not.toHaveBeenCalled()
    }
  )

  it.each([
    { authType: 'session', hasAccess: true, canWrite: true, ownAccount: true, status: 200 },
    { authType: 'api_key', hasAccess: true, canWrite: true, ownAccount: true, status: 401 },
    { authType: 'session', hasAccess: false, canWrite: false, ownAccount: true, status: 403 },
    { authType: 'session', hasAccess: true, canWrite: false, ownAccount: true, status: 403 },
    { authType: 'session', hasAccess: true, canWrite: true, ownAccount: false, status: 404 },
  ])(
    'requires session ownership and write access to save: $status/$authType/$ownAccount',
    async (testCase) => {
      mocks.authenticate.mockResolvedValue({
        success: true,
        authType: testCase.authType,
        userId: 'owner',
      })
      mocks.access.mockResolvedValue(testCase)
      mocks.connections.mockResolvedValue(
        testCase.ownAccount
          ? [{ id: 'personal-account', provider: 'robinhood', name: 'Broker account' }]
          : []
      )
      mocks.db.returning.mockResolvedValue([{ id: 'workspace-credential' }])
      const response = await POST(
        new NextRequest('http://localhost/api/auth/oauth/credentials', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: 'workspace-1',
            accountId: 'personal-account',
            userId: 'forged',
          }),
        })
      )
      expect(response.status).toBe(testCase.status)
      if (testCase.status !== 200) {
        expect(mocks.db.insert).not.toHaveBeenCalled()
        return
      }
      expect(await response.json()).toEqual({ credentialId: 'workspace-credential' })
      expect(mocks.connections).toHaveBeenCalledWith({ userId: 'owner' })
      expect(mocks.db.values).toHaveBeenCalledWith({
        id: 'credential-id',
        workspaceId: 'workspace-1',
        type: 'oauth',
        providerId: 'robinhood',
        displayName: 'Broker account',
        accountId: 'personal-account',
        createdBy: 'owner',
      })
      expect(mocks.db.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: ['workspaceId', 'accountId'],
          targetWhere: { field: 'accountId', type: 'isNotNull' },
        })
      )
    }
  )
})
