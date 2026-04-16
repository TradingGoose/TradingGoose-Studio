import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEnvironmentVariablesServerTool } from './get-environment-variables'

const mocks = vi.hoisted(() => ({
  createPermissionError: vi.fn(() => 'permission denied'),
  getEnvironmentVariableKeys: vi.fn(),
  getPersonalAndWorkspaceEnv: vi.fn(),
  verifyWorkflowAccess: vi.fn(),
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  createPermissionError: mocks.createPermissionError,
  verifyWorkflowAccess: mocks.verifyWorkflowAccess,
}))

vi.mock('@/lib/environment/utils', () => ({
  getEnvironmentVariableKeys: mocks.getEnvironmentVariableKeys,
  getPersonalAndWorkspaceEnv: mocks.getPersonalAndWorkspaceEnv,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('getEnvironmentVariablesServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses ambient current-workflow context to include workspace variables', async () => {
    mocks.verifyWorkflowAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
    })
    mocks.getPersonalAndWorkspaceEnv.mockResolvedValue({
      personalEncrypted: { PERSONAL_KEY: 'encrypted-1' },
      workspaceEncrypted: { WORKSPACE_KEY: 'encrypted-2' },
      conflicts: [],
    })

    await expect(
      getEnvironmentVariablesServerTool.execute({}, {
        userId: 'auth-user',
        contextWorkflowId: 'workflow-1',
      })
    ).resolves.toEqual({
      variableNames: ['PERSONAL_KEY', 'WORKSPACE_KEY'],
      count: 2,
    })

    expect(mocks.verifyWorkflowAccess).toHaveBeenCalledWith('auth-user', 'workflow-1')
    expect(mocks.getPersonalAndWorkspaceEnv).toHaveBeenCalledWith('auth-user', 'workspace-1')
    expect(mocks.getEnvironmentVariableKeys).not.toHaveBeenCalled()
  })
})
