import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockNanoid, mockNotifyEntityListMembersUpserted } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockNanoid: vi.fn(),
  mockNotifyEntityListMembersUpserted: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflow: {
    id: 'workflow.id',
    workspaceId: 'workflow.workspaceId',
  },
  skill: {
    id: 'skill.id',
    workspaceId: 'skill.workspaceId',
    name: 'skill.name',
  },
  customTools: {
    id: 'customTools.id',
    workspaceId: 'customTools.workspaceId',
  },
  pineIndicators: {
    id: 'pineIndicators.id',
    workspaceId: 'pineIndicators.workspaceId',
  },
  mcpServers: {
    id: 'mcpServers.id',
    workspaceId: 'mcpServers.workspaceId',
    deletedAt: 'mcpServers.deletedAt',
  },
  layoutMaps: {
    id: 'layoutMaps.id',
    workspaceId: 'layoutMaps.workspaceId',
    userId: 'layoutMaps.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
  desc: vi.fn((value: unknown) => ({ kind: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
  isNull: vi.fn((value: unknown) => ({ kind: 'isNull', value })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))

vi.mock('nanoid', () => ({
  nanoid: (...args: unknown[]) => mockNanoid(...args),
}))

vi.mock('@/lib/yjs/server/apply-entity-state', () => ({
  applySavedEntityState: vi.fn(),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readSavedEntityListFieldsForExecution: vi.fn(),
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  lockSavedEntityList: vi.fn(),
}))

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  discardYjsSessionInSocketServer: vi.fn(),
  refreshEntityListSession: mockNotifyEntityListMembersUpserted,
}))

import { importSkills } from '@/lib/skills/operations'

const createQueryChain = (result: unknown) => {
  const chain: any = {}

  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)

  return chain
}

describe('skills import operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockReset()
    mockNanoid.mockReset()
  })

  it('returns imported skill metadata in source order even if the db response is reordered', async () => {
    mockNanoid.mockImplementationOnce(() => 'skill-a').mockImplementationOnce(() => 'skill-b')

    const existingNames = [{ name: 'Execution Plan' }]
    const insertedRows = [
      {
        id: 'skill-b',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Execution Plan (imported) 1',
        description: 'Create the execution plan.',
        content: 'Follow the checklist.',
      },
      {
        id: 'skill-a',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Market Research',
        description: 'Research the market.',
        content: 'Review catalysts.',
      },
    ]
    const insertValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(insertedRows),
    })

    const tx: any = {
      execute: vi.fn(),
      select: vi.fn(() => createQueryChain(existingNames)),
      insert: vi.fn(() => ({
        values: insertValues,
      })),
    }

    mockTransaction.mockImplementation(async (callback: (innerTx: unknown) => unknown) =>
      callback(tx)
    )

    const result = await importSkills({
      skills: [
        {
          name: 'Market Research',
          description: 'Research the market.',
          content: 'Review catalysts.',
        },
        {
          name: 'Execution Plan',
          description: 'Create the execution plan.',
          content: 'Follow the checklist.',
        },
      ],
      workspaceId: 'workspace-1',
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(insertValues).toHaveBeenCalledWith([
      {
        id: 'skill-a',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Market Research',
        description: 'Research the market.',
        content: 'Review catalysts.',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
      {
        id: 'skill-b',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Execution Plan (imported) 1',
        description: 'Create the execution plan.',
        content: 'Follow the checklist.',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    ])

    expect(result.skills).toEqual(insertedRows)
    expect(result.importedSkills).toEqual([
      {
        sourceName: 'Market Research',
        skillId: 'skill-a',
        name: 'Market Research',
      },
      {
        sourceName: 'Execution Plan',
        skillId: 'skill-b',
        name: 'Execution Plan (imported) 1',
      },
    ])
    expect(result.importedCount).toBe(2)
    expect(result.renamedCount).toBe(1)
  })
})
