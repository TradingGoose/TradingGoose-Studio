/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const {
  events,
  mockApplyEntityStateInSocketServer,
  mockDbUpdate,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => ({
  events: [] as string[],
  mockApplyEntityStateInSocketServer: vi.fn(),
  mockDbUpdate: vi.fn(),
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
}))

function buildSkillDoc(fields: { name: string; description: string; content: string }) {
  const doc = new Y.Doc()
  const map = doc.getMap('fields')
  map.set('name', fields.name)
  map.set('description', fields.description)
  map.set('content', fields.content)
  return doc
}

describe('applySavedEntityState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    mockApplyEntityStateInSocketServer.mockImplementation(async () => {
      events.push('yjs')
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

  it('materializes saved-entity DB state from a provided Yjs document', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildSkillDoc({
      name: 'Yjs Skill',
      description: 'Yjs description',
      content: 'Use the Yjs document.',
    })

    try {
      await saveSavedEntityYjsDocToDb('skill', 'skill-1', doc)
    } finally {
      doc.destroy()
    }

    expect(mockUpdateSet).toHaveBeenCalledWith({
      name: 'Yjs Skill',
      description: 'Yjs description',
      content: 'Use the Yjs document.',
      updatedAt: expect.any(Date),
    })
    expect(events).toEqual(['db'])
  })

  it('throws when document materialization cannot find the saved entity row', async () => {
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const doc = buildSkillDoc({ name: 'Yjs Skill', description: '', content: '' })
    mockUpdateReturning.mockResolvedValueOnce([])

    try {
      await expect(saveSavedEntityYjsDocToDb('skill', 'skill-1', doc)).rejects.toMatchObject({
        status: 404,
      })
    } finally {
      doc.destroy()
    }
  })

  it('does not materialize DB state when the saved-entity Yjs apply fails', async () => {
    const { applySavedEntityState } = await import('./apply-entity-state')
    mockApplyEntityStateInSocketServer.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(
      applySavedEntityState('skill', 'skill-1', {
        name: 'Copilot Skill',
        description: 'Copilot description',
        content: 'Use the Copilot input.',
      })
    ).rejects.toThrow('fetch failed')

    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})
