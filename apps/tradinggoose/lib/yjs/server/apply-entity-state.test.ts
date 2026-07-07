/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const events: string[] = []
const mockApplyEntityStateInSocketServer = vi.fn()
const mockDbTransaction = vi.fn()
const mockDbUpdate = vi.fn()
const mockMaterializeDashboardLayoutFields = vi.fn()
const mockNormalizeEntityFields = vi.fn((_entityKind, fields) => fields)
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
const mockNormalizeWatchlistDocumentFields = vi.fn((value: Record<string, unknown>) => ({
  name: String(value.name ?? ''),
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
  materializeDashboardLayoutFields: mockMaterializeDashboardLayoutFields,
}))

vi.mock('@/lib/custom-tools/schema', () => ({
  parseCustomToolSchemaText: vi.fn((schemaText) => schemaText),
}))

vi.mock('@/lib/watchlists/document', () => ({
  materializeWatchlistDocumentInTx: mockMaterializeWatchlistDocumentInTx,
}))

vi.mock('@/lib/watchlists/validation', () => ({
  normalizePersistedWatchlistDocumentFields: mockNormalizeWatchlistDocumentFields,
  normalizeWatchlistDocumentFields: mockNormalizeWatchlistDocumentFields,
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

describe('applySavedEntityState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    mockNormalizeEntityFields.mockImplementation((_entityKind, fields) => fields)
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
    mockMaterializeDashboardLayoutFields.mockImplementation(
      async (_scope, _entityId, fields) => fields
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
      name: 'Copilot Skill',
      description: 'Copilot description',
      content: 'Use the Copilot input.',
    })

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith(
      'skill-1',
      'skill',
      {
        name: 'Copilot Skill',
        description: 'Copilot description',
        content: 'Use the Copilot input.',
      },
      null
    )
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

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith(
      'watchlist-1',
      'watchlist',
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
      },
      null
    )
    expect(mockDbTransaction).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('materializes saved-entity DB state from a provided Yjs document', async () => {
    const { getEntityFields } = await import('@/lib/yjs/entity-session')
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    mockNormalizeEntityFields.mockImplementationOnce((_entityKind, fields) => ({
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

  it('refuses to materialize dashboard layouts when the Yjs document has no owner identity', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildDoc({
      name: 'Layout 1',
      layout: {
        id: 'panel-1',
        type: 'panel',
        widget: null,
      },
      colorPairs: { pairs: [] },
      isActive: true,
      sortOrder: 0,
    })

    try {
      await expect(
        saveSavedEntityYjsDocToDb('dashboard_layout', 'layout-1', doc)
      ).rejects.toMatchObject({
        status: 400,
        message: 'Dashboard layout ownerUserId is required',
      })
    } finally {
      doc.destroy()
    }

    expect(mockMaterializeDashboardLayoutFields).not.toHaveBeenCalled()
  })

  it('passes dashboard layout owner scope into materialization', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const fields = {
      name: 'Layout 1',
      layout: {
        id: 'panel-1',
        type: 'panel',
        widget: null,
      },
      colorPairs: { pairs: [] },
      isActive: true,
      sortOrder: 0,
    }
    const doc = buildDoc(fields, 'workspace-1', 'user-1')

    try {
      await expect(saveSavedEntityYjsDocToDb('dashboard_layout', 'layout-1', doc)).resolves.toEqual(
        fields
      )
    } finally {
      doc.destroy()
    }

    expect(mockMaterializeDashboardLayoutFields).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      'layout-1',
      fields
    )
  })

  it('refuses to materialize malformed dashboard layout fields from Yjs', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    mockNormalizeEntityFields.mockImplementationOnce((entityKind, fields) => {
      if (entityKind === 'dashboard_layout') {
        throw new Error('dashboard layout document requires layout')
      }
      return fields
    })
    const doc = buildDoc(
      {
        name: 'Layout 1',
        colorPairs: { pairs: [] },
        isActive: true,
        sortOrder: 0,
      },
      'workspace-1',
      'user-1'
    )

    try {
      await expect(
        saveSavedEntityYjsDocToDb('dashboard_layout', 'layout-1', doc)
      ).rejects.toMatchObject({
        status: 400,
        message: 'dashboard layout document requires layout',
      })
    } finally {
      doc.destroy()
    }

    expect(mockMaterializeDashboardLayoutFields).not.toHaveBeenCalled()
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
      await expect(
        saveSavedEntityYjsDocToDb('watchlist', 'watchlist-1', doc)
      ).rejects.toMatchObject({
        status: 409,
        message: 'A watchlist with this name already exists',
      })
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
