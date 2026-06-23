import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readEnvironmentVariablesServerTool } from './read-environment-variables'

const mocks = vi.hoisted(() => ({
  getPersonalAndWorkspaceEnv: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: mocks.getPersonalAndWorkspaceEnv,
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

describe('readEnvironmentVariablesServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses explicit workspace context to include workspace variables', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'workspace-1' },
    })
    mocks.getPersonalAndWorkspaceEnv.mockResolvedValue({
      personalEncrypted: { PERSONAL_KEY: 'encrypted-1' },
      workspaceEncrypted: { WORKSPACE_KEY: 'encrypted-2' },
      conflicts: [],
    })

    await expect(
      readEnvironmentVariablesServerTool.execute(
        { workspaceId: 'workspace-1' },
        {
          userId: 'auth-user',
        }
      )
    ).resolves.toEqual({
      variableNames: ['PERSONAL_KEY', 'WORKSPACE_KEY'],
      personalVariableNames: ['PERSONAL_KEY'],
      workspaceVariableNames: ['WORKSPACE_KEY'],
      conflicts: [],
      count: 2,
    })

    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'auth-user')
    expect(mocks.getPersonalAndWorkspaceEnv).toHaveBeenCalledWith('auth-user', 'workspace-1')
  })
})
