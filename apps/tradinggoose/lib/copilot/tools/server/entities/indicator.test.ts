import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INDICATOR_DOCUMENT_FORMAT } from '@/lib/copilot/entity-documents'
import { DEFAULT_INDICATOR_RUNTIME_ENTRIES } from '@/lib/indicators/default/runtime'
import { listIndicatorsServerTool, readIndicatorServerTool } from './indicator'

const mockCheckWorkspaceAccess = vi.hoisted(() => vi.fn())
const mockReadBootstrappedSavedEntityFields = vi.hoisted(() => vi.fn())
const mockReadEntityListMembersFromDb = vi.hoisted(() => vi.fn())
const mockVerifyReviewTargetAccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mockCheckWorkspaceAccess(...args),
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: (...args: unknown[]) => mockVerifyReviewTargetAccess(...args),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedSavedEntityFields: (...args: unknown[]) =>
    mockReadBootstrappedSavedEntityFields(...args),
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readEntityListMembersFromDb: (...args: unknown[]) => mockReadEntityListMembersFromDb(...args),
}))

describe('indicator server tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
    })
    mockReadEntityListMembersFromDb.mockResolvedValue([
      {
        id: 'indicator-custom-1',
        name: 'Custom Momentum',
      },
    ])
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
    })
    mockReadBootstrappedSavedEntityFields.mockResolvedValue({
      color: '#10b981',
      pineCode: 'indicator("Custom Momentum")',
    })
  })

  it('lists custom indicators with callable runtime ids', async () => {
    const result = await listIndicatorsServerTool.execute(
      {},
      { userId: 'user-1', workspaceId: 'workspace-1', accessLevel: 'full' }
    )

    expect(result.indicators).toContainEqual(
      expect.objectContaining({
        name: 'Custom Momentum',
        source: 'custom',
        editable: true,
        callableInFunctionBlock: true,
        entityId: 'indicator-custom-1',
        runtimeId: 'indicator-custom-1',
      })
    )
  })

  it('reads default indicators through the staging runtime map', async () => {
    const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_ENTRIES[0]

    const result = await readIndicatorServerTool.execute(
      { runtimeId: defaultIndicator.id },
      { userId: 'user-1', accessLevel: 'full' }
    )

    expect(result).toMatchObject({
      entityKind: 'indicator',
      entityName: defaultIndicator.name,
      documentFormat: INDICATOR_DOCUMENT_FORMAT,
    })
    expect(result).not.toHaveProperty('entityId')
    expect(JSON.parse(result.entityDocument).color).toBe('')
    expect(mockVerifyReviewTargetAccess).not.toHaveBeenCalled()
  })

  it('reads custom indicators by the same runtime id used for Function execution', async () => {
    const result = await readIndicatorServerTool.execute(
      { runtimeId: 'indicator-custom-1' },
      { userId: 'user-1', accessLevel: 'full' }
    )

    expect(mockVerifyReviewTargetAccess).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        entityKind: 'indicator',
        entityId: 'indicator-custom-1',
        yjsSessionId: 'indicator-custom-1',
      }),
      'read'
    )
    expect(mockReadBootstrappedSavedEntityFields).toHaveBeenCalledWith(
      'indicator',
      'indicator-custom-1',
      'workspace-1',
      undefined
    )
    expect(result).toMatchObject({
      entityKind: 'indicator',
      entityId: 'indicator-custom-1',
      entityName: 'Custom Momentum',
      documentFormat: INDICATOR_DOCUMENT_FORMAT,
    })
    expect(JSON.parse(result.entityDocument)).toMatchObject({
      color: '#10b981',
    })
  })
})
