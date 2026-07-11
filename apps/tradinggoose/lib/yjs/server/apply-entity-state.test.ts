/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  ensureDashboardLayoutDirtyTracker,
  getDashboardWidgetsMap,
  isDashboardLayoutDirty,
  readDashboardLayoutContent,
  seedDashboardLayoutSession,
  setDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import type { DashboardLayoutDocumentContent } from '@/widgets/layout-document'

const events: string[] = []
const mockApplyEntityStateInSocketServer = vi.fn()
const mockDbTransaction = vi.fn()
const mockDbUpdate = vi.fn()
const mockPersistDashboardLayoutDirtyChannels = vi.fn()
const mockNormalizeEntityFields = vi.fn((_entityKind, fields) => fields)
class MockDashboardLayoutOperationError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'DashboardLayoutOperationError'
  }
}
class MockWatchlistDocumentError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
    this.name = 'WatchlistDocumentError'
  }
}
const mockMaterializeWatchlistDocumentInTx = vi.fn()
const mockNormalizeWatchlistDocumentContent = vi.fn((value: Record<string, unknown>) => ({
  settings: value.settings ?? { showLogo: true, showTicker: true, showDescription: true },
  items: Array.isArray(value.items) ? value.items : [],
}))
const mockUpdateReturning = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: mockDbTransaction,
    update: mockDbUpdate,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  customTools: { id: 'customTools.id', workspaceId: 'customTools.workspaceId' },
  knowledgeBase: { id: 'knowledgeBase.id', workspaceId: 'knowledgeBase.workspaceId' },
  mcpServers: { id: 'mcpServers.id', workspaceId: 'mcpServers.workspaceId' },
  pineIndicators: { id: 'pineIndicators.id', workspaceId: 'pineIndicators.workspaceId' },
  skill: { id: 'skill.id', workspaceId: 'skill.workspaceId' },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ and: conditions })),
  eq: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@/lib/copilot/entity-documents', () => ({
  normalizeEntityFields: mockNormalizeEntityFields,
}))

vi.mock('@/lib/dashboard-layouts/operations', () => ({
  DashboardLayoutOperationError: MockDashboardLayoutOperationError,
  persistDashboardLayoutDirtyChannels: mockPersistDashboardLayoutDirtyChannels,
}))

vi.mock('@/lib/custom-tools/schema', () => ({
  parseCustomToolSchemaText: vi.fn((schemaText) => schemaText),
}))

vi.mock('@/lib/watchlists/document', () => ({
  materializeWatchlistDocumentInTx: mockMaterializeWatchlistDocumentInTx,
}))

vi.mock('@/lib/watchlists/validation', () => ({
  normalizeWatchlistDocumentContent: mockNormalizeWatchlistDocumentContent,
  resolveWatchlistDocumentItemIds: vi.fn((items) =>
    items.map((item: Record<string, unknown>, index: number) => ({
      ...item,
      id: item.id ?? `item-${index + 1}`,
      parentId: item.parentId ?? null,
    }))
  ),
  WatchlistDocumentError: MockWatchlistDocumentError,
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyEntityStateInSocketServer: mockApplyEntityStateInSocketServer,
}))

function buildDoc(
  fields: Record<string, unknown>,
  workspaceId: string | null = 'workspace-1',
  ownerUserId: string | null = null
) {
  const doc = new Y.Doc()
  const map = doc.getMap('fields')
  for (const [key, value] of Object.entries(fields)) map.set(key, value)
  if (workspaceId !== null) {
    doc.getMap('metadata').set('workspaceId', workspaceId)
  }
  if (ownerUserId !== null) {
    doc.getMap('metadata').set('ownerUserId', ownerUserId)
  }
  return doc
}

function dashboardContent(): DashboardLayoutDocumentContent {
  return {
    layout: {
      id: 'panel-1',
      type: 'panel',
      identityId: 'widget-1',
      widgetKey: null,
    },
    widgets: {
      'widget-1': { pairColor: 'gray', params: null },
    },
    colorPairs: { pairs: [] },
  }
}

function buildDashboardDoc(
  fields: DashboardLayoutDocumentContent = dashboardContent(),
  workspaceId: string | null = 'workspace-1',
  ownerUserId: string | null = 'user-1'
) {
  const doc = new Y.Doc()
  seedDashboardLayoutSession(doc, fields, YJS_ORIGINS.SYSTEM)
  if (workspaceId) doc.getMap('metadata').set('workspaceId', workspaceId)
  if (ownerUserId) doc.getMap('metadata').set('ownerUserId', ownerUserId)
  ensureDashboardLayoutDirtyTracker(doc)
  return doc
}

describe('applySavedEntityState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    mockNormalizeEntityFields.mockImplementation((_entityKind, fields) => fields)
    mockApplyEntityStateInSocketServer.mockImplementation(async () => {
      events.push('yjs')
    })
    mockDbTransaction.mockImplementation(async (callback) => callback({ update: mockDbUpdate }))
    mockMaterializeWatchlistDocumentInTx.mockResolvedValue({
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [
        {
          id: 'listing-1',
          type: 'listing',
          parentId: null,
          listing: {
            listing_type: 'default',
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
          },
        },
      ],
    })
    mockPersistDashboardLayoutDirtyChannels.mockImplementation(async (_scope, _entityId, doc) =>
      readDashboardLayoutContent(doc)
    )
    mockUpdateReturning.mockResolvedValue([{ id: 'skill-1' }])
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning })
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockImplementation(() => {
      events.push('db')
      return { set: mockUpdateSet }
    })
  })

  it('applies entity changes to the socket-owned Yjs session without app-side DB materialization', async () => {
    const { applySavedEntityState } = await import('./apply-entity-state')

    await applySavedEntityState('skill', 'skill-1', {
      description: 'Copilot description',
      content: 'Use the Copilot input.',
    })

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith('skill-1', 'skill', {
      description: 'Copilot description',
      content: 'Use the Copilot input.',
    })
    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(events).toEqual(['yjs'])
  })

  it('applies watchlist changes through the socket-owned saved-entity Yjs session', async () => {
    const { applySavedEntityState } = await import('./apply-entity-state')
    const persistedFields = {
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [
        {
          id: 'listing-1',
          type: 'listing',
          listing: {
            listing_type: 'default',
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
          },
        },
      ],
    }
    mockApplyEntityStateInSocketServer.mockResolvedValueOnce(persistedFields)

    await expect(
      applySavedEntityState('watchlist', 'watchlist-1', {
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [
          {
            type: 'listing',
            listing: {
              listing_type: 'default',
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
            },
          },
        ],
      })
    ).resolves.toEqual(persistedFields)

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith('watchlist-1', 'watchlist', {
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [
        {
          type: 'listing',
          listing: {
            listing_type: 'default',
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
          },
        },
      ],
    })
    expect(mockDbTransaction).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('materializes saved-entity DB state from a provided Yjs document', async () => {
    const { getEntityFields } = await import('@/lib/yjs/entity-session')
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    mockNormalizeEntityFields.mockImplementationOnce((_entityKind, fields) => fields)
    const doc = buildDoc({
      color: '#ff0000',
      pineCode: 'indicator("Draft")',
    })

    try {
      await saveSavedEntityYjsDocToDb('indicator', 'indicator-1', doc)
      expect(getEntityFields(doc, 'indicator')).toEqual({
        color: '#ff0000',
        pineCode: 'indicator("Draft")',
      })
    } finally {
      doc.destroy()
    }

    expect(mockUpdateSet).toHaveBeenCalledWith({
      color: '#ff0000',
      pineCode: 'indicator("Draft")',
      updatedAt: expect.any(Date),
    })
    expect(mockUpdateWhere).toHaveBeenCalledWith({
      and: [
        { field: 'pineIndicators.id', value: 'indicator-1' },
        { field: 'pineIndicators.workspaceId', value: 'workspace-1' },
      ],
    })
    expect(events).toEqual(['db'])
  })

  it('materializes watchlist DB state from a provided Yjs document through the document helper', async () => {
    const { getEntityFields, seedEntitySession } = await import('@/lib/yjs/entity-session')
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = new Y.Doc()
    seedEntitySession(doc, {
      entityKind: 'watchlist',
      payload: {
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [
          {
            id: 'listing-1',
            type: 'listing',
            parentId: null,
            listing: {
              listing_type: 'default',
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
            },
          },
        ],
      },
    })
    doc.getMap('metadata').set('workspaceId', 'workspace-1')

    try {
      await expect(saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', doc)).resolves.toEqual({
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [
          {
            id: 'listing-1',
            type: 'listing',
            parentId: null,
            listing: {
              listing_type: 'default',
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
            },
          },
        ],
      })

      expect(getEntityFields(doc, 'watchlist')).toEqual({
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [
          {
            id: 'listing-1',
            type: 'listing',
            parentId: null,
            listing: {
              listing_type: 'default',
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
            },
          },
        ],
      })
    } finally {
      doc.destroy()
    }

    expect(mockDbTransaction).toHaveBeenCalledTimes(1)
    expect(mockMaterializeWatchlistDocumentInTx).toHaveBeenCalledWith(
      { update: mockDbUpdate },
      'workspace-1',
      'watchlist-1',
      {
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [
          {
            id: 'listing-1',
            type: 'listing',
            parentId: null,
            listing: {
              listing_type: 'default',
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
            },
          },
        ],
      }
    )
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('keeps dashboard layouts out of the generic saved-entity saver contract', async () => {
    const { saveDashboardLayoutYjsDocToDb, saveSavedEntityYjsDocToDb } = await import(
      './apply-entity-state'
    )

    expectTypeOf<'dashboard_layout'>().not.toMatchTypeOf<
      Parameters<typeof saveSavedEntityYjsDocToDb>[0]
    >()
    expect(saveDashboardLayoutYjsDocToDb).toBeTypeOf('function')
  })

  it.each([
    {
      name: 'workspace',
      workspaceId: null,
      ownerUserId: 'user-1',
      status: 404,
      message: 'Saved dashboard_layout layout-1 workspace is missing while materializing Yjs state',
    },
    {
      name: 'owner',
      workspaceId: 'workspace-1',
      ownerUserId: null,
      status: 400,
      message: 'Dashboard layout ownerUserId is required',
    },
  ])(
    'rejects a dedicated dashboard save without $name identity metadata',
    async ({ workspaceId, ownerUserId, status, message }) => {
      const { saveDashboardLayoutYjsDocToDb } = await import('./apply-entity-state')
      const doc = buildDashboardDoc(dashboardContent(), workspaceId, ownerUserId)

      try {
        await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).rejects.toMatchObject({
          status,
          message,
        })
      } finally {
        doc.destroy()
      }

      expect(mockPersistDashboardLayoutDirtyChannels).not.toHaveBeenCalled()
    }
  )

  it('returns a clean dashboard document without falling back to a full-document write', async () => {
    const { saveDashboardLayoutYjsDocToDb } = await import('./apply-entity-state')
    const fields = dashboardContent()
    const doc = buildDashboardDoc(fields)

    try {
      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).resolves.toEqual(fields)
      expect(isDashboardLayoutDirty(doc)).toBe(false)
    } finally {
      doc.destroy()
    }

    expect(mockPersistDashboardLayoutDirtyChannels).not.toHaveBeenCalled()
  })

  it('maps invalid clean dashboard state without falling back to a full-document write', async () => {
    const { saveDashboardLayoutYjsDocToDb } = await import('./apply-entity-state')
    const doc = new Y.Doc()
    seedDashboardLayoutSession(doc, dashboardContent(), YJS_ORIGINS.SYSTEM)
    getDashboardWidgetsMap(doc).delete('widget-1')
    doc.getMap('metadata').set('workspaceId', 'workspace-1')
    doc.getMap('metadata').set('ownerUserId', 'user-1')
    ensureDashboardLayoutDirtyTracker(doc)

    try {
      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/missing widget widget-1/i),
      })
      expect(isDashboardLayoutDirty(doc)).toBe(false)
    } finally {
      doc.destroy()
    }

    expect(mockPersistDashboardLayoutDirtyChannels).not.toHaveBeenCalled()
  })

  it('persists one owner-scoped dirty batch and completes only that generation', async () => {
    const { saveDashboardLayoutYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDashboardDoc()
    const current = readDashboardLayoutContent(doc)
    setDashboardLayoutTopology(doc, { ...current.layout, id: 'panel-renamed' })
    const persisted = readDashboardLayoutContent(doc)
    mockPersistDashboardLayoutDirtyChannels.mockResolvedValueOnce(persisted)

    try {
      expect(isDashboardLayoutDirty(doc)).toBe(true)
      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).resolves.toEqual(persisted)
      expect(isDashboardLayoutDirty(doc)).toBe(false)

      const [scope, entityId, receivedDoc, batch] =
        mockPersistDashboardLayoutDirtyChannels.mock.calls[0]!
      expect(scope).toEqual({ workspaceId: 'workspace-1', ownerUserId: 'user-1' })
      expect(entityId).toBe('layout-1')
      expect(receivedDoc).toBe(doc)
      expect(batch).toMatchObject({ generation: 1, layout: true })
      expect([...batch.widgetIdentityIds]).toEqual([])
      expect([...batch.pairColors]).toEqual([])

      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).resolves.toEqual(persisted)
      expect(mockPersistDashboardLayoutDirtyChannels).toHaveBeenCalledTimes(1)
    } finally {
      doc.destroy()
    }
  })

  it('maps a dashboard operation error, merges the failed batch, and retries it', async () => {
    const { saveDashboardLayoutYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDashboardDoc()
    const current = readDashboardLayoutContent(doc)
    setDashboardLayoutTopology(doc, { ...current.layout, id: 'panel-renamed' })
    const persisted = readDashboardLayoutContent(doc)
    mockPersistDashboardLayoutDirtyChannels
      .mockRejectedValueOnce(new MockDashboardLayoutOperationError(404, 'Layout was not found'))
      .mockResolvedValueOnce(persisted)

    try {
      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).rejects.toMatchObject({
        status: 404,
        message: 'Layout was not found',
      })
      expect(isDashboardLayoutDirty(doc)).toBe(true)

      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).resolves.toEqual(persisted)
      expect(isDashboardLayoutDirty(doc)).toBe(false)

      const firstBatch = mockPersistDashboardLayoutDirtyChannels.mock.calls[0]?.[3]
      const retryBatch = mockPersistDashboardLayoutDirtyChannels.mock.calls[1]?.[3]
      expect(retryBatch).not.toBe(firstBatch)
      expect(retryBatch).toMatchObject({ generation: 1, layout: true })
      expect([...retryBatch.widgetIdentityIds]).toEqual([])
      expect([...retryBatch.pairColors]).toEqual([])
    } finally {
      doc.destroy()
    }
  })

  it('maps cross-layout widget identity collisions and retains the dirty batch', async () => {
    const { saveDashboardLayoutYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDashboardDoc()
    const current = readDashboardLayoutContent(doc)
    setDashboardLayoutTopology(doc, { ...current.layout, id: 'panel-renamed' })
    mockPersistDashboardLayoutDirtyChannels.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' })
    )

    try {
      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).rejects.toMatchObject({
        status: 409,
        message: 'Dashboard widget identity conflicts with another layout',
      })
      expect(isDashboardLayoutDirty(doc)).toBe(true)
    } finally {
      doc.destroy()
    }
  })

  it.each([
    ['database transaction', new Error('database offline')],
    [
      'foreign-key violation',
      Object.assign(new Error('layout owner disappeared'), { code: '23503' }),
    ],
  ])('maps a %s failure and keeps its dirty batch retryable', async (_name, failure) => {
    const { saveDashboardLayoutYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDashboardDoc()
    const current = readDashboardLayoutContent(doc)
    setDashboardLayoutTopology(doc, { ...current.layout, id: 'panel-renamed' })
    const persisted = readDashboardLayoutContent(doc)
    mockPersistDashboardLayoutDirtyChannels
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(persisted)

    try {
      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).rejects.toMatchObject({
        status: 500,
        message: failure.message,
      })
      expect(isDashboardLayoutDirty(doc)).toBe(true)

      await expect(saveDashboardLayoutYjsDocToDb('layout-1', doc)).resolves.toEqual(persisted)
      expect(isDashboardLayoutDirty(doc)).toBe(false)
    } finally {
      doc.destroy()
    }
  })

  it('maps watchlist document persistence errors to saved-entity persistence errors', async () => {
    const { seedEntitySession } = await import('@/lib/yjs/entity-session')
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = new Y.Doc()
    seedEntitySession(doc, {
      entityKind: 'watchlist',
      payload: {
        settings: { showLogo: true, showTicker: true, showDescription: false },
        items: [],
      },
    })
    doc.getMap('metadata').set('workspaceId', 'workspace-1')
    mockMaterializeWatchlistDocumentInTx.mockRejectedValueOnce(
      new MockWatchlistDocumentError('Invalid watchlist hierarchy', 409)
    )

    try {
      await expect(
        saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', doc)
      ).rejects.toMatchObject({
        status: 409,
        message: 'Invalid watchlist hierarchy',
      })
    } finally {
      doc.destroy()
    }
  })

  it('refuses to materialize when the Yjs document carries no workspace identity', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDoc({ description: '', content: '' }, null)

    try {
      await expect(saveSavedEntityYjsDocToDb('skill', 'skill-1', doc)).rejects.toMatchObject({
        status: 404,
      })
    } finally {
      doc.destroy()
    }

    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('throws when document materialization cannot find the saved entity row', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDoc({ description: '', content: '' })
    mockUpdateReturning.mockResolvedValueOnce([])

    try {
      await expect(saveSavedEntityYjsDocToDb('skill', 'skill-1', doc)).rejects.toMatchObject({
        status: 404,
      })
    } finally {
      doc.destroy()
    }
  })

  it('returns the saved-entity realtime contract when the Yjs bridge is unavailable', async () => {
    const { applySavedEntityState } = await import('./apply-entity-state')
    mockApplyEntityStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(
      applySavedEntityState('skill', 'skill-1', {
        description: 'Copilot description',
        content: 'Use the Copilot input.',
      })
    ).rejects.toMatchObject({ status: 503 })

    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})
