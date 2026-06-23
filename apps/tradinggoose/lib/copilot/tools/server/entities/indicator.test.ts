import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INDICATOR_DOCUMENT_FORMAT } from '@/lib/copilot/entity-documents'
import { DEFAULT_INDICATOR_RUNTIME_ENTRIES } from '@/lib/indicators/default/runtime'
import { listIndicatorsServerTool, readIndicatorServerTool } from './indicator'

const mockCheckWorkspaceAccess = vi.hoisted(() => vi.fn())
const mockDbOrderBy = vi.hoisted(() => vi.fn())
const mockReadBootstrappedSavedEntityFields = vi.hoisted(() => vi.fn())
const mockVerifyReviewTargetAccess = vi.hoisted(() => vi.fn())

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: mockDbOrderBy,
        })),
      })),
    })),
  },
}))

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

describe('indicator server tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
    })
    mockDbOrderBy.mockResolvedValue([
      {
        id: 'indicator-custom-1',
        name: 'Custom Momentum',
        pineCode: 'indicator("Custom Momentum")',
        inputMeta: { Length: { defaultValue: 14 } },
        workspaceId: 'workspace-1',
        userId: 'user-1',
        color: '#10b981',
        createdAt: new Date('2026-06-23T00:00:00.000Z'),
        updatedAt: new Date('2026-06-23T00:00:00.000Z'),
      },
    ])
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
    })
    mockReadBootstrappedSavedEntityFields.mockResolvedValue({
      name: 'Custom Momentum',
      pineCode: 'indicator("Custom Momentum")',
      inputMeta: { Length: { defaultValue: 14 } },
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
        inputTitles: ['Length'],
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
      'workspace-1'
    )
    expect(result).toMatchObject({
      entityKind: 'indicator',
      entityId: 'indicator-custom-1',
      entityName: 'Custom Momentum',
      documentFormat: INDICATOR_DOCUMENT_FORMAT,
    })
  })
})
