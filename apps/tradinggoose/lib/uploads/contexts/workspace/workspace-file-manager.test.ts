import { beforeEach, expect, it, vi } from 'vitest'
import { resolveAuthorizedWorkspaceFileReference } from './workspace-file-manager'

const state = vi.hoisted(() => ({ row: null as any, access: vi.fn() }))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (state.row ? [state.row] : []) }) }),
    }),
  },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: state.access }))
vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: vi.fn(),
  decrementStorageUsage: vi.fn(),
  incrementStorageUsage: vi.fn(),
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
}))
beforeEach(() => {
  vi.clearAllMocks()
  state.row = {
    id: 'file',
    key: 'workspace/document.txt',
    workspaceId: 'workspace',
    name: 'document.txt',
    type: 'text/plain',
  }
  state.access.mockResolvedValue({ hasAccess: true })
})
it('uses the actual stored workspace row even when the request labels it general', async () => {
  const file = await resolveAuthorizedWorkspaceFileReference(
    '/api/files/serve/s3/workspace/document.txt?context=general',
    'actor'
  )
  expect(file?.workspaceId).toBe('workspace')
  expect(state.access).toHaveBeenCalledWith('workspace', 'actor')
})
it('rejects missing permission and inconsistent URL locators', async () => {
  state.access.mockResolvedValueOnce({ hasAccess: false })
  await expect(
    resolveAuthorizedWorkspaceFileReference('workspace/document.txt', 'actor')
  ).rejects.toThrow('denied')
  await expect(
    resolveAuthorizedWorkspaceFileReference(
      '/api/files/serve/workspace/document.txt?fileId=other',
      'actor'
    )
  ).rejects.toThrow('denied')
})
it('returns no workspace owner for ordinary files and rejects a missing declared workspace file', async () => {
  state.row = null
  expect(await resolveAuthorizedWorkspaceFileReference('general.txt', 'actor')).toBeNull()
  await expect(
    resolveAuthorizedWorkspaceFileReference('/api/files/serve/missing?context=workspace', 'actor')
  ).rejects.toThrow('denied')
})
