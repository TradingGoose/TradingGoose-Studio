import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listGDriveFilesServerTool } from './list-files'

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

describe('listGDriveFilesServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses authenticated route context as the user source', async () => {
    mocks.getOAuthToken.mockResolvedValue('google-token')
    mocks.executeTool.mockResolvedValue({
      success: true,
      output: {
        files: [{ id: 'file-1', name: 'Report' }],
        nextPageToken: 'next-page',
      },
    })

    await expect(
      listGDriveFilesServerTool.execute({ search_query: 'report' }, { userId: 'auth-user' })
    ).resolves.toEqual({
      files: [{ id: 'file-1', name: 'Report' }],
      total: 1,
      nextPageToken: 'next-page',
    })

    expect(mocks.getUserId).not.toHaveBeenCalled()
    expect(mocks.getOAuthToken).toHaveBeenCalledWith('auth-user', 'google-drive')
    expect(mocks.executeTool).toHaveBeenCalledWith('google_drive_list', {
      accessToken: 'google-token',
      query: 'report',
    })
  })
})
