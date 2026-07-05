/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const {
  events,
  mockApplyEntityStateInSocketServer,
  mockDbTransaction,
  mockDbUpdate,
  MockWatchlistDocumentError,
  mockMaterializeWatchlistDocumentInTx,
  mockNormalizeWatchlistDocumentFields,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => ({
  events: [] as string[],
  mockApplyEntityStateInSocketServer: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDbUpdate: vi.fn(),
  MockWatchlistDocumentError: class WatchlistDocumentError extends Error {
    constructor(
      message: string,
      public status = 400
    ) {
      super(message)
      this.name = 'WatchlistDocumentError'
    }
  },
  mockMaterializeWatchlistDocumentInTx: vi.fn(),
  mockNormalizeWatchlistDocumentFields: vi.fn((value: Record<string, unknown>) => ({
    name: String(value.name ?? ''),
    settings: value.settings ?? { showLogo: true, showTicker: true, showDescription: true },
    items: Array.isArray(value.items) ? value.items : [],
  })),
  mockUpdateReturning: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
}))

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
  normalizeEntityFields: vi.fn((_entityKind, fields) => fields),
}))

vi.mock('@/lib/custom-tools/schema', () => ({
  parseCustomToolSchemaText: vi.fn((schemaText) => schemaText),
}))

vi.mock('@/lib/watchlists/document', () => ({
  materializeWatchlistDocumentInTx: mockMaterializeWatchlistDocumentInTx,
  normalizeWatchlistDocumentFields: mockNormalizeWatchlistDocumentFields,
  WatchlistDocumentError: MockWatchlistDocumentError,
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyEntityStateInSocketServer: mockApplyEntityStateInSocketServer,
}))

function buildDoc(fields: Record<string, unknown>, workspaceId: string | null = 'workspace-1') {
  const doc = new Y.Doc()
  const map = doc.getMap('fields')
  for (const [key, value] of Object.entries(fields)) map.set(key, value)
  if (workspaceId !== null) {
    doc.getMap('metadata').set('workspaceId', workspaceId)
  }
  return doc
}

describe('applySavedEntityState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    mockApplyEntityStateInSocketServer.mockImplementation(async () => {
      events.push('yjs')
    })
    mockDbTransaction.mockImplementation(async (callback) => callback('tx'))
    mockMaterializeWatchlistDocumentInTx.mockResolvedValue({
      name: 'Persisted Watchlist',
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
    })
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
      name: 'Copilot Skill',
      description: 'Copilot description',
      content: 'Use the Copilot input.',
    })

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith('skill-1', 'skill', {
      name: 'Copilot Skill',
      description: 'Copilot description',
      content: 'Use the Copilot input.',
    })
    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(events).toEqual(['yjs'])
  })

  it('applies watchlist changes through the socket-owned saved-entity Yjs session', async () => {
    const { applySavedEntityState } = await import('./apply-entity-state')
    const persistedFields = {
      name: 'Persisted Watchlist',
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
        name: 'Draft Watchlist',
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
      name: 'Draft Watchlist',
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
    const { normalizeEntityFields } = await import('@/lib/copilot/entity-documents')
    const { getEntityFields } = await import('@/lib/yjs/entity-session')
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    vi.mocked(normalizeEntityFields).mockImplementationOnce((_entityKind, fields) => ({
      ...fields,
      name: 'Canonical Indicator',
    }))
    const doc = buildDoc({
      name: 'Draft Indicator',
      color: '#ff0000',
      pineCode: 'indicator("Draft")',
    })

    try {
      await saveSavedEntityYjsDocToDb('indicator', 'indicator-1', doc)
      expect(getEntityFields(doc, 'indicator')).toEqual({
        name: 'Canonical Indicator',
        color: '#ff0000',
        pineCode: 'indicator("Draft")',
      })
    } finally {
      doc.destroy()
    }

    expect(mockUpdateSet).toHaveBeenCalledWith({
      name: 'Canonical Indicator',
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
    const { getEntityFields } = await import('@/lib/yjs/entity-session')
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDoc({
      name: 'Draft Watchlist',
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

    try {
      await expect(saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', doc)).resolves.toEqual({
        name: 'Persisted Watchlist',
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
      })

      expect(getEntityFields(doc, 'watchlist')).toEqual({
        name: 'Persisted Watchlist',
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
      })
    } finally {
      doc.destroy()
    }

    expect(mockDbTransaction).toHaveBeenCalledTimes(1)
    expect(mockMaterializeWatchlistDocumentInTx).toHaveBeenCalledWith(
      'tx',
      'workspace-1',
      'watchlist-1',
      {
        name: 'Draft Watchlist',
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
      }
    )
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('maps watchlist document persistence errors to saved-entity persistence errors', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDoc({
      name: 'Duplicate Watchlist',
      settings: { showLogo: true, showTicker: true, showDescription: false },
      items: [],
    })
    mockMaterializeWatchlistDocumentInTx.mockRejectedValueOnce(
      new MockWatchlistDocumentError('A watchlist with this name already exists', 409)
    )

    try {
      await expect(saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', doc)).rejects.toMatchObject(
        {
          status: 409,
          message: 'A watchlist with this name already exists',
        }
      )
    } finally {
      doc.destroy()
    }
  })

  it('refuses to materialize when the Yjs document carries no workspace identity', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDoc({ name: 'Yjs Skill', description: '', content: '' }, null)

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
    const doc = buildDoc({ name: 'Yjs Skill', description: '', content: '' })
    mockUpdateReturning.mockResolvedValueOnce([])

    try {
      await expect(saveSavedEntityYjsDocToDb('skill', 'skill-1', doc)).rejects.toMatchObject({
        status: 404,
      })
    } finally {
      doc.destroy()
    }
  })

  it('maps saved-entity unique constraint failures to validation errors', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' })
    const skillDoc = buildDoc({ name: 'Yjs Skill', description: '', content: '' })
    const customToolDoc = buildDoc({ title: 'Yjs Tool', schemaText: '{}', codeText: '' })

    try {
      mockUpdateReturning.mockRejectedValueOnce(duplicate)
      await expect(saveSavedEntityYjsDocToDb('skill', 'skill-1', skillDoc)).rejects.toMatchObject({
        status: 409,
        message: 'A skill with the name "Yjs Skill" already exists in this workspace',
      })

      mockUpdateReturning.mockRejectedValueOnce(duplicate)
      await expect(
        saveSavedEntityYjsDocToDb('custom_tool', 'tool-1', customToolDoc)
      ).rejects.toMatchObject({
        status: 409,
        message: 'A tool with the title "Yjs Tool" already exists in this workspace',
      })
    } finally {
      skillDoc.destroy()
      customToolDoc.destroy()
    }
  })

  it('returns the saved-entity realtime contract when the Yjs bridge is unavailable', async () => {
    const { applySavedEntityState } = await import('./apply-entity-state')
    mockApplyEntityStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(
      applySavedEntityState('skill', 'skill-1', {
        name: 'Copilot Skill',
        description: 'Copilot description',
        content: 'Use the Copilot input.',
      })
    ).rejects.toMatchObject({ status: 503 })

    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})
