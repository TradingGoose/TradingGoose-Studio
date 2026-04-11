/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockGetUserEntityPermissions,
  mockGetWorkspaceById,
  mockResolveWorkspaceBillingOwnerUpdate,
  mockToWorkspaceApiRecord,
  mockUpdateWhere,
  mockLogger,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockGetWorkspaceById: vi.fn(),
  mockResolveWorkspaceBillingOwnerUpdate: vi.fn(),
  mockToWorkspaceApiRecord: vi.fn((workspace) => workspace),
  mockUpdateWhere: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const mockUpdateSet = vi.fn(() => ({
  where: mockUpdateWhere,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: mockUpdateSet,
    })),
  },
  knowledgeBase: {},
  permissions: {},
  templates: {},
  workflow: {
    id: 'workflow.id',
    workspaceId: 'workflow.workspaceId',
  },
  workspace: {
    id: 'workspace.id',
  },
}))

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    ...actual,
    eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
    and: vi.fn((...conditions) => ({ conditions, type: 'and' })),
    inArray: vi.fn((field, values) => ({ field, values, type: 'inArray' })),
  }
})

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(),
  getUserEntityPermissions: (...args: unknown[]) => mockGetUserEntityPermissions(...args),
  getWorkspaceById: (...args: unknown[]) => mockGetWorkspaceById(...args),
}))

vi.mock('@/lib/workspaces/billing-owner', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workspaces/billing-owner')>(
    '@/lib/workspaces/billing-owner'
  )

  return {
    ...actual,
    resolveWorkspaceBillingOwnerUpdate: (...args: unknown[]) =>
      mockResolveWorkspaceBillingOwnerUpdate(...args),
    toWorkspaceApiRecord: (workspace: unknown) => mockToWorkspaceApiRecord(workspace),
  }
})

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

describe('Workspace by id PATCH route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockGetWorkspaceById.mockReset()
    mockResolveWorkspaceBillingOwnerUpdate.mockReset()
    mockUpdateWhere.mockReset()
  })

  it('returns 500 when the workspace update fails unexpectedly', async () => {
    mockGetWorkspaceById.mockResolvedValue({
      id: 'workspace-1',
      ownerId: 'owner-1',
    })
    mockUpdateWhere.mockRejectedValue(new Error('database offline'))

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated workspace' }),
      }),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to update workspace' })
  })

  it('keeps billing owner validation errors as 400 responses', async () => {
    const { WorkspaceBillingOwnerUpdateError } = await import('@/lib/workspaces/billing-owner')

    mockGetWorkspaceById.mockResolvedValue({
      id: 'workspace-1',
      ownerId: 'owner-1',
    })
    mockResolveWorkspaceBillingOwnerUpdate.mockRejectedValue(
      new WorkspaceBillingOwnerUpdateError('Workspace billing owner user must have admin access')
    )

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1', {
        method: 'PATCH',
        body: JSON.stringify({
          billingOwner: {
            type: 'user',
            userId: 'user-2',
          },
        }),
      }),
      { params: Promise.resolve({ id: 'workspace-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Workspace billing owner user must have admin access',
    })
  })
})
