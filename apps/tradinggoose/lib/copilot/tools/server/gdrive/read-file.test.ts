import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readGDriveFileServerTool } from './read-file'

const mocks = vi.hoisted(() => ({
  executeTool: vi.fn(),
  getOAuthToken: vi.fn(),
  getUserId: vi.fn(),
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  getOAuthToken: mocks.getOAuthToken,
  getUserId: mocks.getUserId,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/tools', () => ({
  executeTool: mocks.executeTool,
}))

describe('readGDriveFileServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses authenticated route context as the user source', async () => {
    mocks.getOAuthToken.mockResolvedValue('google-token')
    mocks.executeTool.mockResolvedValue({
      success: true,
      output: {
        content: 'Document content',
        metadata: { title: 'Report' },
      },
    })

    await expect(
      readGDriveFileServerTool.execute({ fileId: 'file-1', type: 'doc' }, { userId: 'auth-user' })
    ).resolves.toEqual({
      type: 'doc',
      content: 'Document content',
      metadata: { title: 'Report' },
    })

    expect(mocks.getUserId).not.toHaveBeenCalled()
    expect(mocks.getOAuthToken).toHaveBeenCalledWith('auth-user', 'google-drive')
    expect(mocks.executeTool).toHaveBeenCalledWith('google_drive_get_content', {
      accessToken: 'google-token',
      fileId: 'file-1',
    })
  })
})
