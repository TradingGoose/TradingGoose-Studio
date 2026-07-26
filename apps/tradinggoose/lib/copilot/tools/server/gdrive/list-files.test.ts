import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listGDriveFilesServerTool } from './list-files'

const mocks = vi.hoisted(() => ({
  checkWorkspaceAccess: vi.fn(),
  executeTool: vi.fn(),
  getOAuthAccessTokenForUserCredential: vi.fn(),
}))

vi.mock('@/lib/credentials/oauth', () => ({
  getOAuthAccessTokenForUserCredential: mocks.getOAuthAccessTokenForUserCredential,
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
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

  it('uses explicit workspaceId and authenticated route context as the user source', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
    })
    mocks.getOAuthAccessTokenForUserCredential.mockResolvedValue('google-token')
    mocks.executeTool.mockResolvedValue({
      success: true,
      output: {
        files: [{ id: 'file-1', name: 'Report' }],
        nextPageToken: 'next-page',
      },
    })

    await expect(
      listGDriveFilesServerTool.execute(
        { workspaceId: 'workspace-1', credentialId: 'credential-1', search_query: 'report' },
        {
          userId: 'auth-user',
        }
      )
    ).resolves.toEqual({
      files: [{ id: 'file-1', name: 'Report' }],
      total: 1,
      nextPageToken: 'next-page',
    })

    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'auth-user')
    expect(mocks.getOAuthAccessTokenForUserCredential).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      userId: 'auth-user',
      requestId: 'copilot-gdrive-list-credential-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.executeTool).toHaveBeenCalledWith(
      'google_drive_list',
      {
        accessToken: 'google-token',
        query: 'report',
      },
      false,
      undefined,
      { signal: undefined }
    )
  })
})
