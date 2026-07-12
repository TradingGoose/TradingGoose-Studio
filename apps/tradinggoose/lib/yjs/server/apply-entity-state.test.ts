/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  seedDashboardColorPairSession,
  seedDashboardWidgetSession,
} from '@/lib/yjs/dashboard-layout-session'

const events: string[] = []
const mockApplyEntityStateInSocketServer = vi.fn()
const mockDbTransaction = vi.fn()
const mockDbUpdate = vi.fn()
const mockPersistDashboardWidgetDocument = vi.fn()
const mockPersistDashboardColorPairDocument = vi.fn()
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
  persistDashboardWidgetDocument: mockPersistDashboardWidgetDocument,
  persistDashboardColorPairDocument: mockPersistDashboardColorPairDocument,
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

function buildDoc(fields: Record<string, unknown>) {
  const doc = new Y.Doc()
  const map = doc.getMap('fields')
  for (const [key, value] of Object.entries(fields)) map.set(key, value)
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
    mockPersistDashboardWidgetDocument.mockImplementation(
      async (_scope, _layoutId, _identityId, content) => content
    )
    mockPersistDashboardColorPairDocument.mockImplementation(
      async (_scope, _layoutId, _color, content) => content
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

    await applySavedEntityState('skill', 'skill-1', 'workspace-1', {
      description: 'Copilot description',
      content: 'Use the Copilot input.',
    })

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith(
      'skill-1',
      'skill',
      'workspace-1',
      {
        description: 'Copilot description',
        content: 'Use the Copilot input.',
      },
      undefined
    )
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
      applySavedEntityState('watchlist', 'watchlist-1', 'workspace-1', {
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

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith(
      'watchlist-1',
      'watchlist',
      'workspace-1',
      {
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
      },
      undefined
    )
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
      await saveSavedEntityYjsDocToDb('indicator', 'indicator-1', 'workspace-1', doc)
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
    try {
      await expect(
        saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', 'workspace-1', doc)
      ).resolves.toEqual({
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
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')

    expectTypeOf<'dashboard_layout'>().not.toMatchTypeOf<
      Parameters<typeof saveSavedEntityYjsDocToDb>[0]
    >()
  })

  it('persists a widget document through only its child owner', async () => {
    const { saveDashboardWidgetYjsDocToDb } = await import('./apply-entity-state')
    const doc = new Y.Doc()
    seedDashboardWidgetSession(doc, { pairColor: 'blue', params: { view: {} } })

    try {
      await saveDashboardWidgetYjsDocToDb(
        'dashboard-widget:layout-1:widget-1',
        { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
        doc
      )
    } finally {
      doc.destroy()
    }

    expect(mockPersistDashboardWidgetDocument).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      'layout-1',
      'widget-1',
      { pairColor: 'blue', params: { view: {} } }
    )
    expect(mockPersistDashboardColorPairDocument).not.toHaveBeenCalled()
  })

  it('persists a color-pair document through only its child owner', async () => {
    const { saveDashboardColorPairYjsDocToDb } = await import('./apply-entity-state')
    const doc = new Y.Doc()
    seedDashboardColorPairSession(doc, { watchlistId: 'watchlist-1' })

    try {
      await saveDashboardColorPairYjsDocToDb(
        'dashboard-color-pair:layout-1:red',
        { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
        doc
      )
    } finally {
      doc.destroy()
    }

    expect(mockPersistDashboardColorPairDocument).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      'layout-1',
      'red',
      { watchlistId: 'watchlist-1' }
    )
    expect(mockPersistDashboardWidgetDocument).not.toHaveBeenCalled()
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
    mockMaterializeWatchlistDocumentInTx.mockRejectedValueOnce(
      new MockWatchlistDocumentError('Invalid watchlist hierarchy', 409)
    )

    try {
      await expect(
        saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', 'workspace-1', doc)
      ).rejects.toMatchObject({
        status: 409,
        message: 'Invalid watchlist hierarchy',
      })
    } finally {
      doc.destroy()
    }
  })

  it('uses authenticated scope instead of client-editable document metadata', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDoc({ description: '', content: '' })
    doc.getMap('metadata').set('workspaceId', 'attacker-workspace')

    try {
      await saveSavedEntityYjsDocToDb('skill', 'skill-1', 'workspace-1', doc)
    } finally {
      doc.destroy()
    }

    expect(mockUpdateWhere).toHaveBeenCalledWith({
      and: [
        { field: 'skill.id', value: 'skill-1' },
        { field: 'skill.workspaceId', value: 'workspace-1' },
      ],
    })
  })

  it('throws when document materialization cannot find the saved entity row', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDoc({ description: '', content: '' })
    mockUpdateReturning.mockResolvedValueOnce([])

    try {
      await expect(
        saveSavedEntityYjsDocToDb('skill', 'skill-1', 'workspace-1', doc)
      ).rejects.toMatchObject({ status: 404 })
    } finally {
      doc.destroy()
    }
  })

  it('returns the saved-entity realtime contract when the Yjs bridge is unavailable', async () => {
    const { applySavedEntityState } = await import('./apply-entity-state')
    mockApplyEntityStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(
      applySavedEntityState('skill', 'skill-1', 'workspace-1', {
        description: 'Copilot description',
        content: 'Use the Copilot input.',
      })
    ).rejects.toMatchObject({ status: 503 })

    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})
