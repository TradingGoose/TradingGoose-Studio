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
    const { normalizeEntityFields } = await import('@/lib/copilot/entity-documents')
    const { getEntityFields } = await import('@/lib/yjs/entity-session')
    const { saveSavedEntityYjsDocToDb } = await import('./apply-entity-state')
    const inputMeta = {
      length: { name: 'length', title: 'Length', type: 'int', defval: 14 },
    }
    vi.mocked(normalizeEntityFields).mockImplementationOnce((_entityKind, fields) => ({
      ...fields,
      name: 'Canonical Indicator',
      inputMeta,
    }))
    const doc = buildDoc({
      name: 'Draft Indicator',
      color: '#ff0000',
      pineCode: 'indicator("Draft")',
      inputMeta: { stale: true },
    })

    try {
      await saveSavedEntityYjsDocToDb('indicator', 'indicator-1', doc)
      expect(getEntityFields(doc, 'indicator')).toEqual({
        name: 'Canonical Indicator',
        color: '#ff0000',
        pineCode: 'indicator("Draft")',
        inputMeta,
      })
    } finally {
      doc.destroy()
    }

    expect(mockUpdateSet).toHaveBeenCalledWith({
      name: 'Canonical Indicator',
      color: '#ff0000',
      pineCode: 'indicator("Draft")',
      inputMeta,
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
