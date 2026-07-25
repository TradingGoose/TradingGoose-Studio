import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardLayoutOperationError } from '@/lib/dashboard-layouts/operations'
import { SavedEntityIdentityError } from '@/lib/saved-entities/identity'
import { POST as mutateStructure } from './[layoutId]/structure/route'
import { POST as mutateList } from './route'

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
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
  listDashboardLayouts: vi.fn().mockResolvedValue([{ id: 'layout-1' }]),
  reorderDashboardLayouts: mocks.reorder,
}))
vi.mock('@/lib/saved-entities/identity', async (importOriginal) => ({
  ...(await importOriginal()),
  renameSavedEntityIdentity: mocks.rename,
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyDashboardStructureMutationInSocketServer: mocks.apply,
}))
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
  ['create', { type: 'create' }, mocks.create, undefined],
  [
    'stale reorder',
    { type: 'reorder', layoutOrder: ['missing'] },
    mocks.reorder,
    new DashboardLayoutOperationError(400, 'Invalid layout order'),
  ],
  [
    'missing rename',
    { type: 'rename', layoutId: 'missing', name: 'Renamed' },
    mocks.rename,
    new SavedEntityIdentityError(404, 'Layout not found'),
  ],
] as const)('preserves the %s result', async (_case, mutation, operation, error) => {
  if (error) operation.mockRejectedValueOnce(error)
  const response = await post('list', JSON.stringify(mutation))
  expect(response.status).toBe(error?.status ?? 200)
  expect(await response.json()).toEqual(error ? { error: error.message } : [{ id: 'layout-1' }])
})
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
