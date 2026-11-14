/** @vitest-environment node */
import { beforeEach, expect, it, vi } from 'vitest'
import { checkStorageQuota } from '@/lib/billing/storage'
import { firefliesUploadAudioTool } from '@/tools/fireflies/upload_audio'
import { formatRequestParams } from '@/tools/utils'
import {
  resolveAuthorizedWorkspaceFileReference,
  uploadWorkspaceFile,
} from './workspace-file-manager'

const state = vi.hoisted(() => ({
  row: null as any,
  access: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  sign: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => {
      state.read()
      return {
        from: () => ({ where: () => ({ limit: async () => (state.row ? [state.row] : []) }) }),
      }
    },
    insert: () => ({
      values: async (row: unknown) => {
        state.row = row
      },
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
  uploadFile: state.upload,
  generatePresignedDownloadUrl: state.sign,
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
}))
vi.mock('@/lib/uploads', () => ({ getServePathPrefix: () => '/api/files/serve/s3/' }))
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
  state.sign.mockReset().mockResolvedValue('https://storage.example/audio.mp3?signed=now')
  state.upload.mockResolvedValue({ key: 'workspace/audio.mp3' })
  vi.mocked(checkStorageQuota).mockResolvedValue({ allowed: true } as any)
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

it('signs new workspace uploads at the actual Fireflies request boundary', async () => {
  state.row = null
  const file = await uploadWorkspaceFile(
    'workspace',
    'actor',
    Buffer.from('recording'),
    'audio.mp3',
    'audio/mpeg'
  )
  expect(file.url).toMatch(/^\/api\/files\/serve\/s3\//)
  expect(state.sign).not.toHaveBeenCalled()
  const request = await formatRequestParams(firefliesUploadAudioTool, {
    apiKey: 'service-key',
    audioFile: file,
    _context: { userId: 'actor' },
  })
  expect(JSON.parse(request.body as string).variables.input.url).toBe(
    'https://storage.example/audio.mp3?signed=now'
  )
  expect(state.sign).toHaveBeenCalledExactlyOnceWith('workspace/audio.mp3', 'workspace', 86400)
  expect(state.access).toHaveBeenCalledWith('workspace', 'actor')
})

it('resolves saved workspace picker paths and refuses revoked access or signing failures', async () => {
  const params = {
    apiKey: 'service-key',
    audioFile: { path: '/api/files/serve/s3/workspace%2Fdocument.txt?context=workspace' },
    _context: { userId: 'actor' },
  }
  expect((await formatRequestParams(firefliesUploadAudioTool, params)).body).toContain(
    'https://storage.example/audio.mp3?signed=now'
  )
  expect(state.sign).toHaveBeenCalledWith('workspace/document.txt', 'workspace', 86400)
  state.sign.mockClear()
  state.access.mockResolvedValueOnce({ hasAccess: false })
  await expect(formatRequestParams(firefliesUploadAudioTool, params)).rejects.toThrow('denied')
  expect(state.sign).not.toHaveBeenCalled()
  await expect(
    formatRequestParams(firefliesUploadAudioTool, { ...params, _context: undefined })
  ).rejects.toThrow('denied')
  expect(state.sign).not.toHaveBeenCalled()
  state.sign.mockRejectedValueOnce(new Error('Signing unavailable'))
  await expect(formatRequestParams(firefliesUploadAudioTool, params)).rejects.toThrow(
    'Signing unavailable'
  )
  state.sign.mockResolvedValueOnce('/api/files/serve/workspace/document.txt')
  await expect(formatRequestParams(firefliesUploadAudioTool, params)).rejects.toThrow(
    'Audio URL must be a valid HTTPS URL'
  )
})

it('forwards ordinary HTTPS audio without accessing workspace storage', async () => {
  const request = await formatRequestParams(firefliesUploadAudioTool, {
    apiKey: 'service-key',
    audioUrl: 'https://example.com/recording.mp3',
  })
  expect(JSON.parse(request.body as string).variables.input.url).toBe(
    'https://example.com/recording.mp3'
  )
  expect(state.read).not.toHaveBeenCalled()
  expect(state.sign).not.toHaveBeenCalled()
})
