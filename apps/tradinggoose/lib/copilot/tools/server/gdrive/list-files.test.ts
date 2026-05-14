import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listGDriveFilesServerTool } from './list-files'

const mocks = vi.hoisted(() => ({
  executeTool: vi.fn(),
  getOAuthAccessTokenForUserCredential: vi.fn(),
  verifyWorkflowAccess: vi.fn(),
}))

vi.mock('@/lib/credentials/oauth', () => ({
  getOAuthAccessTokenForUserCredential: mocks.getOAuthAccessTokenForUserCredential,
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
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

describe('listGDriveFilesServerTool', () => {
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
        files: [{ id: 'file-1', name: 'Report' }],
        nextPageToken: 'next-page',
      },
    })

    await expect(
      listGDriveFilesServerTool.execute(
        { credentialId: 'credential-1', search_query: 'report' },
        { userId: 'auth-user', contextWorkflowId: 'workflow-1' }
      )
    ).resolves.toEqual({
      files: [{ id: 'file-1', name: 'Report' }],
      total: 1,
      nextPageToken: 'next-page',
    })

    expect(mocks.verifyWorkflowAccess).toHaveBeenCalledWith('auth-user', 'workflow-1', 'read')
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
