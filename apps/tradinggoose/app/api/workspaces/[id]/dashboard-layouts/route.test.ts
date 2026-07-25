import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardLayoutOperationError } from '@/lib/dashboard-layouts/operations'
import { SavedEntityIdentityError } from '@/lib/saved-entities/identity'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  reorder: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
}))
vi.mock('@/lib/permissions/utils', () => ({
  getCachedWorkspaceAccess: vi.fn().mockResolvedValue({ exists: true, hasAccess: true }),
}))
vi.mock('@/lib/dashboard-layouts/operations', async (importOriginal) => ({
  ...(await importOriginal()),
  createDashboardLayout: mocks.create,
  reorderDashboardLayouts: mocks.reorder,
}))
vi.mock('@/lib/saved-entities/identity', async (importOriginal) => ({
  ...(await importOriginal()),
  renameSavedEntityIdentity: mocks.rename,
}))

const invoke = (mutation: unknown) =>
  POST(
    new NextRequest('http://localhost/api/workspaces/workspace-1/dashboard-layouts', {
      method: 'POST',
      body: JSON.stringify(mutation),
    }),
    { params: Promise.resolve({ id: 'workspace-1' }) }
  )

describe('dashboard layout-list route', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['create', { type: 'create' }, mocks.create, undefined, 204],
    [
      'operation error',
      { type: 'reorder', layoutOrder: ['missing'] },
      mocks.reorder,
      new DashboardLayoutOperationError(400, 'Invalid layout order'),
      400,
    ],
    [
      'identity error',
      { type: 'rename', layoutId: 'missing', name: 'Renamed' },
      mocks.rename,
      new SavedEntityIdentityError(404, 'Layout not found'),
      404,
    ],
  ] as const)('preserves the %s result', async (_case, mutation, operation, error, status) => {
    if (error) operation.mockRejectedValueOnce(error)

    const response = await invoke(mutation)

    expect(response.status).toBe(status)
    if (error) expect(await response.json()).toEqual({ error: error.message })
  })
})
