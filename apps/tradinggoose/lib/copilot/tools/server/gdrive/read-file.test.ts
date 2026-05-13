import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readGDriveFileServerTool } from './read-file'

const mocks = vi.hoisted(() => ({
  executeTool: vi.fn(),
  getOAuthAccessTokenForUserCredential: vi.fn(),
  verifyWorkflowAccess: vi.fn(),
  createPermissionError: vi.fn(() => 'permission denied'),
}))

vi.mock('@/lib/credentials/oauth', () => ({
  getOAuthAccessTokenForUserCredential: mocks.getOAuthAccessTokenForUserCredential,
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  createPermissionError: mocks.createPermissionError,
  verifyWorkflowAccess: mocks.verifyWorkflowAccess,
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
    mocks.verifyWorkflowAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
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
        { credentialId: 'credential-1', fileId: 'file-1', type: 'doc' },
        { userId: 'auth-user', contextWorkflowId: 'workflow-1' }
      )
    ).resolves.toEqual({
      type: 'doc',
      content: 'Document content',
      metadata: { title: 'Report' },
    })

    expect(mocks.verifyWorkflowAccess).toHaveBeenCalledWith('auth-user', 'workflow-1', 'read')
    expect(mocks.getOAuthAccessTokenForUserCredential).toHaveBeenCalledWith({
      credentialId: 'credential-1',
      userId: 'auth-user',
      requestId: 'copilot-gdrive-read-credential-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.executeTool).toHaveBeenCalledWith('google_drive_get_content', {
      accessToken: 'google-token',
      fileId: 'file-1',
    })
  })
})
