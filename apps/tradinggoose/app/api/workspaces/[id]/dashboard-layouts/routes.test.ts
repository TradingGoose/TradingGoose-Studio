import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DashboardLayoutOperationError,
  type DashboardLayoutTab,
} from '@/lib/dashboard-layouts/operations'
import { SavedEntityIdentityError } from '@/lib/saved-entities/identity'
import { POST as mutateStructure } from './[layoutId]/structure/route'
import { POST as mutateList } from './route'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  activate: vi.fn(),
  apply: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  rename: vi.fn(),
  reorder: vi.fn(),
  session: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  getSession: mocks.session,
}))
vi.mock('@/lib/permissions/utils', () => ({
  getCachedWorkspaceAccess: mocks.access,
}))
vi.mock('@/lib/dashboard-layouts/operations', async (importOriginal) => ({
  ...(await importOriginal()),
  activateDashboardLayout: mocks.activate,
  createDashboardLayout: mocks.create,
  deleteDashboardLayout: mocks.delete,
  listDashboardLayouts: mocks.list,
  reorderDashboardLayouts: mocks.reorder,
}))
vi.mock('@/lib/saved-entities/identity', async (importOriginal) => ({
  ...(await importOriginal()),
  renameSavedEntityIdentity: mocks.rename,
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyDashboardStructureMutationInSocketServer: mocks.apply,
}))
const layouts = [
  {
    id: 'layout-1',
    name: 'Layout 1',
    sortOrder: 0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
] satisfies DashboardLayoutTab[]
const ownerScope = { workspaceId: 'workspace-1', ownerUserId: 'user-1' }
mocks.session.mockResolvedValue({ user: { id: 'user-1' } })
mocks.access.mockResolvedValue({ exists: true, hasAccess: true, canWrite: false })
mocks.list.mockResolvedValue(layouts)
const post = (route: 'list' | 'structure', body: string, headers = {}) => {
  const structure = route === 'structure'
  const path = `/api/workspaces/workspace-1/dashboard-layouts${structure ? '/layout-1/structure' : ''}`
  const request = new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', host: 'localhost', ...headers },
  })
  return structure
    ? mutateStructure(request, {
        params: Promise.resolve({ id: 'workspace-1', layoutId: 'layout-1' }),
      })
    : mutateList(request, { params: Promise.resolve({ id: 'workspace-1' }) })
}
beforeEach(() => vi.clearAllMocks())
it.each([
  ['create', { type: 'create' }, mocks.create, [ownerScope]],
  [
    'activate',
    { type: 'activate', layoutId: 'layout-1' },
    mocks.activate,
    [ownerScope, 'layout-1'],
  ],
  ['delete', { type: 'delete', layoutId: 'layout-1' }, mocks.delete, [ownerScope, 'layout-1']],
  [
    'reorder',
    { type: 'reorder', layoutOrder: ['layout-1'] },
    mocks.reorder,
    [ownerScope, ['layout-1']],
  ],
  [
    'rename',
    { type: 'rename', layoutId: 'layout-1', name: 'Renamed' },
    mocks.rename,
    [
      {
        entityKind: 'dashboard_layout',
        entityId: 'layout-1',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        name: 'Renamed',
      },
    ],
  ],
] as const)(
  'dispatches %s and returns the complete projection',
  async (_case, mutation, operation, args) => {
    const response = await post('list', JSON.stringify(mutation))
    expect(operation).toHaveBeenCalledWith(...args)
    expect(mocks.list).toHaveBeenCalledWith(ownerScope)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(layouts)
  }
)
it.each([
  [
    { type: 'reorder', layoutOrder: ['missing'] },
    mocks.reorder,
    new DashboardLayoutOperationError(400, 'Invalid layout order'),
  ],
  [
    { type: 'rename', layoutId: 'missing', name: 'Renamed' },
    mocks.rename,
    new SavedEntityIdentityError(404, 'Layout not found'),
  ],
] as const)('preserves list mutation errors', async (mutation, operation, error) => {
  operation.mockRejectedValueOnce(error)
  const response = await post('list', JSON.stringify(mutation))
  expect(response.status).toBe(error.status)
  expect(await response.json()).toEqual({ error: error.message })
  expect(mocks.list).not.toHaveBeenCalled()
})
it.each([
  [
    'missing session',
    () => mocks.session.mockResolvedValueOnce(null),
    '{"type":"create"}',
    401,
    { error: 'Unauthorized' },
    0,
  ],
  [
    'missing workspace access',
    () => mocks.access.mockResolvedValueOnce({ exists: true, hasAccess: false, canWrite: false }),
    '{"type":"create"}',
    403,
    { error: 'Workspace access is required' },
    1,
  ],
  ['malformed JSON', undefined, '{', 400, { error: 'Invalid dashboard layout mutation' }, 1],
] as const)(
  'rejects %s before list mutation dispatch',
  async (_case, setup, body, status, responseBody, accessCalls) => {
    setup?.()
    const response = await post('list', body)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(responseBody)
    expect(mocks.access).toHaveBeenCalledTimes(accessCalls)
    for (const operation of [
      mocks.create,
      mocks.activate,
      mocks.delete,
      mocks.reorder,
      mocks.rename,
      mocks.list,
    ]) {
      expect(operation).not.toHaveBeenCalled()
    }
  }
)
const resize = { type: 'resize', groupId: 'group-1', sizes: [40, 60] }
const resizeBody = JSON.stringify(resize)
const scope = { entityId: 'layout-1', workspaceId: 'workspace-1', ownerUserId: 'user-1' }
it.each([
  ['malformed', '{', 400, undefined],
  ['null', 'null', 204, null],
  ['resize', resizeBody, 204, resize],
])('handles %s structure JSON', async (_case, body, status, mutation) => {
  const response = await post('structure', body)
  expect(response.status).toBe(status)
  if (status === 400) {
    expect(await response.json()).toEqual({ error: 'Invalid JSON in request body' })
    expect(mocks.apply).not.toHaveBeenCalled()
  } else {
    expect(mocks.apply).toHaveBeenLastCalledWith({ ...scope, mutation })
  }
})
const forwarded = { host: 'p', origin: 'https://a.co', 'x-forwarded-host': 'a.co,p' }
describe.each([
  ['list', (headers = {}) => post('list', '{"type":"create"}', headers), mocks.create, 200],
  ['structure', (headers = {}) => post('structure', resizeBody, headers), mocks.apply, 204],
] as const)('%s request boundary', (_route, invoke, operation, successStatus) => {
  it.each([
    ['same origin', { origin: 'http://localhost' }, successStatus, true],
    ['forwarded host', forwarded, successStatus, true],
    ['sibling origin', { origin: 'https://sibling.example.test' }, 403, false],
    ['non-JSON content', { 'content-type': 'text/plain' }, 415, false],
  ])('handles %s', async (_case, headers, status, called) => {
    const response = await invoke(headers)
    expect(response.status).toBe(status)
    expect(operation).toHaveBeenCalledTimes(called ? 1 : 0)
  })
})
