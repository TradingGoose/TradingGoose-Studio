/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import * as Y from 'yjs'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
import {
  getDashboardWidgetMap,
  seedDashboardColorPairSession,
  seedDashboardWidgetSession,
} from '@/lib/yjs/dashboard-layout-session'
import { SavedEntityPersistenceError } from '@/lib/yjs/entity-state'

const events: string[] = []
const mockApplyEntityStateInSocketServer = vi.fn()
const mockDbTransaction = vi.fn()
const mockDbUpdate = vi.fn()
const mockPersistDashboardWidgetAndColorPairDocuments = vi.fn()
const mockNormalizeEntityFields = vi.fn((_entityKind, fields) => fields)
const mockLockSavedEntityList = vi.fn()
class MockDashboardLayoutOperationError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'DashboardLayoutOperationError'
  }
}
const mockMaterializeWatchlistDocumentInTx = vi.fn()
const mockUpdateReturning = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockRenameSavedEntityIdentityInTx = vi.fn()
class MockSavedEntityIdentityError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message)
  }
}
class MockSocketServerBridgeError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}
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

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  lockSavedEntityList: (...args: unknown[]) => mockLockSavedEntityList(...args),
}))

vi.mock('@/lib/dashboard-layouts/operations', () => ({
  DashboardLayoutOperationError: MockDashboardLayoutOperationError,
  persistDashboardWidgetAndColorPairDocuments: mockPersistDashboardWidgetAndColorPairDocuments,
}))

vi.mock('@/lib/custom-tools/schema', () => ({
  parseCustomToolSchemaText: vi.fn((schemaText) => schemaText),
}))

vi.mock('@/lib/saved-entities/identity', () => ({
  renameSavedEntityIdentityInTx: mockRenameSavedEntityIdentityInTx,
  SavedEntityIdentityError: MockSavedEntityIdentityError,
}))

vi.mock('@/lib/watchlists/document', () => ({
  materializeWatchlistDocumentInTx: mockMaterializeWatchlistDocumentInTx,
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyEntityStateInSocketServer: mockApplyEntityStateInSocketServer,
  SocketServerBridgeError: MockSocketServerBridgeError,
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
    mockLockSavedEntityList.mockResolvedValue(undefined)
    mockApplyEntityStateInSocketServer.mockImplementation(async () => {
      events.push('yjs')
    })
    mockPersistDashboardWidgetAndColorPairDocuments.mockImplementation(
      async (_scope, _layoutId, commit) => ({
        ...(commit.widget ? { widget: commit.widget.content } : {}),
        ...(commit.colorPair ? { colorPair: commit.colorPair.content } : {}),
      })
    )
    mockDbTransaction.mockImplementation(async (callback) => callback({ update: mockDbUpdate }))
    mockRenameSavedEntityIdentityInTx.mockResolvedValue({
      name: 'Renamed',
      updatedAt: new Date('2026-07-13T12:00:00.000Z'),
    })
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
    mockUpdateReturning.mockResolvedValue([{ id: 'skill-1' }])
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning })
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockImplementation(() => {
      events.push('db')
      return { set: mockUpdateSet }
    })
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
    expect(mockLockSavedEntityList).not.toHaveBeenCalled()
  })

  it('serializes a watchlist Yjs rename with its materialization', async () => {
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
    mockLockSavedEntityList.mockImplementationOnce(async (_tx, entityKind, workspaceId) => {
      events.push(`lock:${entityKind}:${workspaceId}`)
    })
    mockRenameSavedEntityIdentityInTx.mockImplementationOnce(async () => {
      events.push('rename')
      return { name: 'Renamed', updatedAt: new Date('2026-07-13T12:00:00.000Z') }
    })
    mockMaterializeWatchlistDocumentInTx.mockImplementationOnce(async () => {
      events.push('materialize')
      return { settings: { showLogo: true, showTicker: true, showDescription: false }, items: [] }
    })

    try {
      await saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', 'workspace-1', doc, {
        identity: { name: 'Renamed' },
      })
    } finally {
      doc.destroy()
    }

    expect(mockRenameSavedEntityIdentityInTx).toHaveBeenCalledWith(
      { update: mockDbUpdate },
      {
        entityKind: 'watchlist',
        entityId: 'watchlist-1',
        workspaceId: 'workspace-1',
        name: 'Renamed',
      }
    )
    expect(events).toEqual(['lock:watchlist:workspace-1', 'rename', 'materialize'])
  })

  it('materializes saved-entity DB state from a provided Yjs document', async () => {
    const { getEntityFields, getFieldsMap, seedEntitySession } = await import(
      '@/lib/yjs/entity-session'
    )
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    mockNormalizeEntityFields.mockReturnValueOnce({
      color: '#ff0000',
      pineCode: 'indicator("Canonical")',
    })
    const doc = new Y.Doc()
    seedEntitySession(doc, {
      entityKind: 'indicator',
      payload: { color: ' #ff0000 ', pineCode: 'indicator("Draft")' },
    })
    const pineCode = getFieldsMap(doc).get('pineCode')

    try {
      await saveSavedEntityYjsDocToDb('indicator', 'indicator-1', 'workspace-1', doc)
      expect(getEntityFields(doc, 'indicator')).toEqual({
        color: '#ff0000',
        pineCode: 'indicator("Canonical")',
      })
      expect(getFieldsMap(doc).get('pineCode')).toBe(pineCode)
    } finally {
      doc.destroy()
    }

    expect(mockUpdateSet).toHaveBeenCalledWith({
      color: '#ff0000',
      pineCode: 'indicator("Canonical")',
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
    const fields = {
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'listing' as const,
          parentId: null,
          listing: {
            listing_type: 'default' as const,
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
          },
        },
      ],
    }
    const doc = new Y.Doc()
    seedEntitySession(doc, {
      entityKind: 'watchlist',
      payload: fields,
    })
    mockMaterializeWatchlistDocumentInTx.mockResolvedValueOnce(fields)
    try {
      await expect(
        saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', 'workspace-1', doc)
      ).resolves.toEqual(fields)

      expect(getEntityFields(doc, 'watchlist')).toEqual(fields)
    } finally {
      doc.destroy()
    }

    expect(mockDbTransaction).toHaveBeenCalledTimes(1)
    expect(mockMaterializeWatchlistDocumentInTx).toHaveBeenCalledWith(
      { update: mockDbUpdate },
      'workspace-1',
      'watchlist-1',
      fields
    )
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('keeps dashboard layouts out of the generic saved-entity saver contract', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')

    expectTypeOf<'dashboard_layout'>().not.toMatchTypeOf<
      Parameters<typeof saveSavedEntityYjsDocToDb>[0]
    >()
  })

  it('persists only canonical widget child documents', async () => {
    const { saveDashboardYjsDocsToDb } = await import('./apply-entity-state')
    const doc = new Y.Doc()
    seedDashboardWidgetSession(doc, { pairColor: 'blue', params: { view: {} } })

    try {
      await saveDashboardYjsDocsToDb(
        { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
        { widget: { sessionId: 'dashboard-widget:layout-1:widget-1', doc } }
      )
      const widget = getDashboardWidgetMap(doc)
      for (const params of [undefined, {}]) {
        if (params === undefined) widget.delete('params')
        else widget.set('params', params)
        const error = await saveDashboardYjsDocsToDb(
          { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
          { widget: { sessionId: 'dashboard-widget:layout-1:widget-1', doc } }
        ).catch((reason) => reason)
        expect(error).toBeInstanceOf(SavedEntityPersistenceError)
        expect(error).toMatchObject({ status: 400, retryable: false })
      }
    } finally {
      doc.destroy()
    }

    expect(mockPersistDashboardWidgetAndColorPairDocuments).toHaveBeenCalledTimes(1)
    expect(mockPersistDashboardWidgetAndColorPairDocuments).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      'layout-1',
      {
        widget: {
          identityId: 'widget-1',
          content: { pairColor: 'blue', params: { view: {} } },
        },
      }
    )
  })

  it('persists widget and color-pair Yjs owners through one storage commit', async () => {
    const { saveDashboardYjsDocsToDb } = await import('./apply-entity-state')
    const widgetDoc = new Y.Doc()
    const pairDoc = new Y.Doc()
    seedDashboardWidgetSession(widgetDoc, { pairColor: 'red', params: { view: {} } })
    seedDashboardColorPairSession(pairDoc, { watchlistId: 'watchlist-1' })

    try {
      await saveDashboardYjsDocsToDb(
        { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
        {
          widget: { sessionId: 'dashboard-widget:layout-1:widget-1', doc: widgetDoc },
          colorPair: { sessionId: 'dashboard-color-pair:layout-1:red', doc: pairDoc },
        }
      )
    } finally {
      widgetDoc.destroy()
      pairDoc.destroy()
    }

    expect(mockPersistDashboardWidgetAndColorPairDocuments).toHaveBeenCalledOnce()
    expect(mockPersistDashboardWidgetAndColorPairDocuments).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      'layout-1',
      {
        widget: {
          identityId: 'widget-1',
          content: { pairColor: 'red', params: { view: {} } },
        },
        colorPair: { color: 'red', content: { watchlistId: 'watchlist-1' } },
      }
    )
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
      new WatchlistDocumentError('Invalid watchlist hierarchy', 409)
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

  it.each([
    [new MockSocketServerBridgeError(410, 'Review target expired'), 410, false],
    [new TypeError('fetch failed'), 503, true],
  ])(
    'maps socket transport failures to the saved-entity contract',
    async (failure, status, retryable) => {
      const { applySavedEntityState } = await import('./apply-entity-state')
      mockApplyEntityStateInSocketServer.mockRejectedValueOnce(failure)

      await expect(
        applySavedEntityState('skill', 'skill-1', 'workspace-1', {
          description: 'Copilot description',
          content: 'Use the Copilot input.',
        })
      ).rejects.toMatchObject({ status, retryable })

      expect(mockDbUpdate).not.toHaveBeenCalled()
      expect(events).toEqual([])
    }
  )

  it('preserves structured bridge status, code, and retryability', async () => {
    const { toSavedEntityTransportError } = await import('./apply-entity-state')
    expect(
      toSavedEntityTransportError(
        new StructuredServerToolError({
          status: 409,
          body: { error: 'Review is stale', code: 'stale_server_tool_review', retryable: true },
        })
      )
    ).toMatchObject({
      status: 409,
      code: 'stale_server_tool_review',
      retryable: true,
    })
  })
})
