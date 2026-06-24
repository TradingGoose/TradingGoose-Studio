/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const {
  events,
  mockApplyEntityStateInSocketServer,
  mockDbUpdate,
  mockGetYjsSnapshot,
  mockReadSavedEntityFieldsFromDb,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => ({
  events: [] as string[],
  mockApplyEntityStateInSocketServer: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockGetYjsSnapshot: vi.fn(),
  mockReadSavedEntityFieldsFromDb: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    update: mockDbUpdate,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  customTools: { id: 'customTools.id' },
  knowledgeBase: { id: 'knowledgeBase.id' },
  mcpServers: { id: 'mcpServers.id' },
  pineIndicators: { id: 'pineIndicators.id' },
  skill: { id: 'skill.id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@/lib/copilot/entity-documents', () => ({
  normalizeEntityFields: vi.fn((_entityKind, fields) => fields),
}))

vi.mock('@/lib/custom-tools/schema', () => ({
  parseCustomToolSchemaText: vi.fn((schemaText) => schemaText),
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyEntityStateInSocketServer: mockApplyEntityStateInSocketServer,
  getYjsSnapshot: mockGetYjsSnapshot,
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readSavedEntityFieldsFromDb: mockReadSavedEntityFieldsFromDb,
}))

function buildSkillSnapshotBase64(fields: {
  name: string
  description: string
  content: string
}) {
  const doc = new Y.Doc()
  try {
    const map = doc.getMap('fields')
    map.set('name', fields.name)
    map.set('description', fields.description)
    map.set('content', fields.content)
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  } finally {
    doc.destroy()
  }
}

describe('applySavedEntityPersistedState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    mockApplyEntityStateInSocketServer.mockImplementation(async () => {
      events.push('yjs')
    })
    mockGetYjsSnapshot.mockImplementation(async () => {
      events.push('snapshot')
      return {
        snapshotBase64: buildSkillSnapshotBase64({
          name: 'Yjs Skill',
          description: 'Yjs description',
          content: 'Use the Yjs document.',
        }),
        descriptor: {},
        runtime: {},
        touchedAt: Date.now(),
      }
    })
    mockReadSavedEntityFieldsFromDb.mockResolvedValue({
      name: 'DB Skill',
      description: 'DB description',
      content: 'Use the saved database state.',
    })
    mockUpdateReturning.mockResolvedValue([{ id: 'skill-1' }])
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning })
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockDbUpdate.mockImplementation(() => {
      events.push('db')
      return { set: mockUpdateSet }
    })
  })

  it('applies entity changes to Yjs before persisting the post-apply Yjs snapshot to DB', async () => {
    const { applySavedEntityPersistedState } = await import('./apply-entity-state')

    await applySavedEntityPersistedState('skill', 'skill-1', 'workspace-1', {
      name: 'Copilot Skill',
      description: 'Copilot description',
      content: 'Use the Copilot input.',
    })

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith('skill-1', 'skill', {
      name: 'Copilot Skill',
      description: 'Copilot description',
      content: 'Use the Copilot input.',
    })
    expect(mockGetYjsSnapshot).toHaveBeenCalledWith(
      'skill-1',
      expect.objectContaining({
        targetKind: 'entity',
        sessionId: 'skill-1',
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        entityId: 'skill-1',
      })
    )
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Yjs Skill',
        description: 'Yjs description',
        content: 'Use the Yjs document.',
      })
    )
    expect(events).toEqual(['yjs', 'snapshot', 'db'])
  })

  it('refreshes the saved-entity Yjs session from DB when materialization fails', async () => {
    const { persistSavedEntityYjsState } = await import('./apply-entity-state')
    mockUpdateReturning.mockResolvedValueOnce([])

    await expect(
      persistSavedEntityYjsState('skill', 'skill-1', 'workspace-1')
    ).rejects.toMatchObject({
      status: 404,
    })

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith('skill-1', 'skill', {
      name: 'DB Skill',
      description: 'DB description',
      content: 'Use the saved database state.',
    })
    expect(events).toEqual(['snapshot', 'db', 'yjs'])
  })
})
