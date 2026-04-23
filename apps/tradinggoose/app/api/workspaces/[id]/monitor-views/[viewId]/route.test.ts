/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MONITOR_VIEW_CONFIG } from '@/app/workspace/[workspaceId]/monitor/components/view-config'

const { mockGetSession, mockSelectLimit, mockUpdateWhere, mockDeleteWhere } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockDeleteWhere: vi.fn(),
}))

const mockSelectWhere = vi.fn(() => ({
  limit: mockSelectLimit,
}))

const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
}))

const mockSelect = vi.fn(() => ({
  from: mockSelectFrom,
}))

const mockUpdateSet = vi.fn(() => ({
  where: mockUpdateWhere,
}))

const mockUpdate = vi.fn(() => ({
  set: mockUpdateSet,
}))

const mockDelete = vi.fn(() => ({
  where: mockDeleteWhere,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  monitorView: {
    id: 'monitorView.id',
    workspaceId: 'monitorView.workspaceId',
    userId: 'monitorView.userId',
    name: 'monitorView.name',
    config: 'monitorView.config',
    isActive: 'monitorView.isActive',
    updatedAt: 'monitorView.updatedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

describe('monitor view item route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockSelectLimit.mockReset()
    mockUpdateWhere.mockReset()
    mockDeleteWhere.mockReset()
  })

  it('updates a saved monitor view name and config', async () => {
    mockSelectLimit.mockResolvedValue([{ id: 'view-1' }])
    mockUpdateWhere.mockResolvedValue(undefined)

    const { PATCH } = await import('./route')
    const response = await PATCH(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Operations',
          config: {
            ...DEFAULT_MONITOR_VIEW_CONFIG,
            filters: {
              ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
              assetTypes: ['STOCK', 'stock'],
            },
          },
        }),
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-1' }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Operations',
        config: {
          ...DEFAULT_MONITOR_VIEW_CONFIG,
          filters: {
            ...DEFAULT_MONITOR_VIEW_CONFIG.filters,
            assetTypes: ['stock'],
          },
        },
        updatedAt: expect.any(Date),
      })
    )
  })

  it('rejects deleting the active saved view', async () => {
    mockSelectLimit.mockResolvedValue([{ id: 'view-1', isActive: true }])

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-1', {
        method: 'DELETE',
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-1' }),
      }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Cannot delete active view' })
  })

  it('deletes an inactive saved view', async () => {
    mockSelectLimit.mockResolvedValue([{ id: 'view-2', isActive: false }])
    mockDeleteWhere.mockResolvedValue(undefined)

    const { DELETE } = await import('./route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/workspaces/workspace-1/monitor-views/view-2', {
        method: 'DELETE',
      }),
      {
        params: Promise.resolve({ id: 'workspace-1', viewId: 'view-2' }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1)
  })
})
