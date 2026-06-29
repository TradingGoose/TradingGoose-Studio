import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readGDriveFileServerTool } from './read-file'

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

describe('readGDriveFileServerTool', () => {
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
        content: 'Document content',
        metadata: { title: 'Report' },
      },
    })

    await expect(
      readGDriveFileServerTool.execute(
        { workspaceId: 'workspace-1', credentialId: 'credential-1', fileId: 'file-1', type: 'doc' },
        {
          userId: 'auth-user',
        }
      )
    ).resolves.toEqual({
      type: 'doc',
      content: 'Document content',
      metadata: { title: 'Report' },
    })

    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'auth-user')
    expect(mocks.getOAuthAccessTokenForUserCredential).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      userId: 'auth-user',
      requestId: 'copilot-gdrive-read-credential-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.executeTool).toHaveBeenCalledWith(
      'google_drive_get_content',
      {
        accessToken: 'google-token',
        fileId: 'file-1',
      },
      false,
      undefined,
      { signal: undefined }
    )
  })
})
