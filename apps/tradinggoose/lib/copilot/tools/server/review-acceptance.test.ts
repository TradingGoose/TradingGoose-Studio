import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  row: vi.fn(),
  inserted: vi.fn(),
  route: vi.fn(),
  claimed: vi.fn(),
  deleted: vi.fn(),
  decrypt: vi.fn(),
  claimWhere: vi.fn(),
  values: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: m.row }) }) }),
    insert: () => ({ values: m.inserted }),
    update: () => ({
      set: (value: unknown) => {
        m.values(value)
        return {
          where: (condition: unknown) => {
            m.claimWhere(condition)
            return { returning: m.claimed }
          },
        }
      },
    }),
    delete: () => ({ where: () => ({ returning: m.deleted }) }),
  },
}))
vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: m.route }))
vi.mock('@/lib/utils-server', () => ({
  encryptSecret: async (value: string) => ({ encrypted: value }),
  decryptSecret: m.decrypt,
}))

import {
  acceptServerManagedToolReview,
  rejectServerManagedToolReview,
  stageServerManagedToolReview,
} from './review-acceptance'

const context = {
  userId: 'actor',
  workspaceId: 'entity-workspace',
  nativeReviewBinding: 'digest-only-original-target-args-financial-scope',
}
const originalArgs = { entityId: 'workflow', entityDocument: 'document' }
function staged(binding: string | undefined = context.nativeReviewBinding) {
  return {
    userId: 'actor',
    toolName: 'edit_workflow',
    encryptedPayload: JSON.stringify(originalArgs),
    baseStateHash: 'original-base',
    nativeReviewBinding: binding,
    executionContext: { workspaceId: 'entity-workspace' },
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  m.row.mockResolvedValue([
    { id: 'token-row', expiresAt: new Date(Date.now() + 60000), value: JSON.stringify(staged()) },
  ])
  m.claimed.mockResolvedValue([{ id: 'token-row' }])
  m.deleted.mockResolvedValue([{ id: 'token-row' }])
  m.decrypt.mockImplementation(async (value: string) => ({ decrypted: value }))
  m.route
    .mockResolvedValueOnce({ requiresReview: true, reviewBaseStateHash: 'original-base' })
    .mockResolvedValueOnce({ success: true })
})
describe('native-bound existing business review tokens', () => {
  it('stores only a digest binding in existing encrypted-review authority and does not expose internal base/hash', async () => {
    const result = await stageServerManagedToolReview(
      'edit_workflow',
      originalArgs,
      { requiresReview: true, reviewBaseStateHash: 'original-base', preview: {} },
      context
    )
    expect(result).toMatchObject({ requiresReview: true, reviewToken: expect.any(String) })
    expect(result).not.toHaveProperty('reviewBaseStateHash')
    expect(result).not.toHaveProperty('nativeReviewBinding')
    expect(JSON.parse(m.inserted.mock.calls[0]![0].value)).toMatchObject({
      nativeReviewBinding: context.nativeReviewBinding,
      userId: 'actor',
      toolName: 'edit_workflow',
    })
    expect(m.route).not.toHaveBeenCalled()
  })
  it.each(['different-native-target', undefined])(
    'refuses token binding %j before re-preview or effect claim',
    async (binding) => {
      m.row.mockResolvedValueOnce([
        {
          id: 'token-row',
          expiresAt: new Date(Date.now() + 60000),
          value: JSON.stringify({ ...staged(), nativeReviewBinding: binding }),
        },
      ])
      await expect(
        acceptServerManagedToolReview('edit_workflow', 'token', context)
      ).rejects.toThrow('does not match')
      expect(m.route).not.toHaveBeenCalled()
      expect(m.claimed).not.toHaveBeenCalled()
    }
  )
  it('retains current limited re-preview, base comparison and conditional claim before one full effect', async () => {
    expect(await acceptServerManagedToolReview('edit_workflow', 'token', context)).toEqual({
      success: true,
    })
    expect(m.route).toHaveBeenNthCalledWith(
      1,
      'edit_workflow',
      originalArgs,
      expect.objectContaining({
        userId: 'actor',
        accessLevel: 'limited',
        nativeReviewBinding: context.nativeReviewBinding,
      })
    )
    expect(m.route).toHaveBeenNthCalledWith(
      2,
      'edit_workflow',
      originalArgs,
      expect.objectContaining({
        accessLevel: 'full',
        acceptedReviewBaseStateHash: 'original-base',
        nativeReviewBinding: context.nativeReviewBinding,
      })
    )
    expect(m.claimed.mock.invocationCallOrder[0]).toBeLessThan(m.route.mock.invocationCallOrder[1]!)
    expect(m.deleted).toHaveBeenCalledOnce()
  })
  it('a lost same-token claim refuses the full effect', async () => {
    m.claimed.mockResolvedValueOnce([])
    await expect(acceptServerManagedToolReview('edit_workflow', 'token', context)).rejects.toThrow(
      'invalid or expired'
    )
    expect(m.route).toHaveBeenCalledOnce()
    expect(m.route.mock.calls[0]![2].accessLevel).toBe('limited')
  })
  it('rejects a real current preview with the same original-value/id/unexpired CAS and no full mutation', async () => {
    const result = await rejectServerManagedToolReview('edit_workflow', 'token', context)
    expect(result).toEqual({ success: false, rejected: true, toolName: 'edit_workflow' })
    expect(m.route).toHaveBeenCalledOnce()
    expect(m.route.mock.calls[0][2].accessLevel).toBe('limited')
    const query = new PgDialect().sqlToQuery(m.claimWhere.mock.calls[0][0])
    expect(query.sql).toContain('"id"')
    expect(query.sql).toContain('"expires_at" >')
    expect(query.params).toEqual(
      expect.arrayContaining([
        'token-row',
        'copilot-tool-review:token',
        JSON.stringify(staged()),
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      ])
    )
    expect(m.deleted).toHaveBeenCalledOnce()
    expect(result).not.toHaveProperty('requiresReview')
    expect(result).not.toHaveProperty('entityDocument')
  })
  it.each(['userId', 'toolName', 'nativeReviewBinding'])(
    'reject refuses wrong staged %s without a claim',
    async (field) => {
      m.row.mockResolvedValue([
        {
          id: 'token-row',
          expiresAt: new Date(Date.now() + 60000),
          value: JSON.stringify({ ...staged(), [field]: 'other' }),
        },
      ])
      await expect(
        rejectServerManagedToolReview('edit_workflow', 'token', context)
      ).rejects.toThrow('does not match')
      expect(m.claimed).not.toHaveBeenCalled()
      expect(m.route).not.toHaveBeenCalled()
    }
  )
  it.each(['workspaceId', 'contextEntityKind', 'contextEntityId'])(
    'reject refuses conflicting %s rather than substituting business scope',
    async (field) => {
      await expect(
        rejectServerManagedToolReview('edit_workflow', 'token', { ...context, [field]: 'wrong' })
      ).rejects.toThrow('does not match execution context')
      expect(m.route).not.toHaveBeenCalled()
      expect(m.claimed).not.toHaveBeenCalled()
    }
  )
  it('expired or already claimed decisions cannot mint a rejection', async () => {
    m.row.mockResolvedValueOnce([
      { id: 'token-row', value: JSON.stringify(staged()), expiresAt: new Date(0) },
    ])
    await expect(rejectServerManagedToolReview('edit_workflow', 'token', context)).rejects.toThrow(
      'invalid or expired'
    )
    m.row.mockResolvedValueOnce([
      { id: 'token-row', value: 'claimed:other-decision', expiresAt: new Date(Date.now() + 60000) },
    ])
    await expect(rejectServerManagedToolReview('edit_workflow', 'token', context)).rejects.toThrow(
      'invalid or expired'
    )
    expect(m.claimed).not.toHaveBeenCalled()
  })
  it('a stale or absent genuine preview refuses rejection before claiming or full execution', async () => {
    m.route
      .mockReset()
      .mockResolvedValueOnce({ requiresReview: true, reviewBaseStateHash: 'changed' })
      .mockResolvedValueOnce({ success: true })
    await expect(rejectServerManagedToolReview('edit_workflow', 'token', context)).rejects.toThrow(
      'stale'
    )
    await expect(rejectServerManagedToolReview('edit_workflow', 'token', context)).rejects.toThrow(
      'genuine current'
    )
    expect(m.claimed).not.toHaveBeenCalled()
  })
  it('a losing Reject claim or missing consume acknowledgement never announces rejected', async () => {
    m.claimed.mockResolvedValueOnce([])
    await expect(rejectServerManagedToolReview('edit_workflow', 'token', context)).rejects.toThrow(
      'invalid or expired'
    )
    m.route
      .mockReset()
      .mockResolvedValue({ requiresReview: true, reviewBaseStateHash: 'original-base' })
    m.deleted.mockResolvedValueOnce([])
    await expect(rejectServerManagedToolReview('edit_workflow', 'token', context)).rejects.toThrow(
      'acknowledgement'
    )
    expect(m.route.mock.calls.every((call) => call[2].accessLevel === 'limited')).toBe(true)
  })
  it('never restores a usable token after an uncertain full mutation reply', async () => {
    m.route
      .mockReset()
      .mockResolvedValueOnce({ requiresReview: true, reviewBaseStateHash: 'original-base' })
      .mockRejectedValueOnce(new Error('effect reply lost'))
    await expect(acceptServerManagedToolReview('edit_workflow', 'token', context)).rejects.toThrow(
      'effect reply lost'
    )
    expect(m.values).toHaveBeenCalledOnce()
    expect(m.values.mock.calls[0][0].value).toMatch(/^claimed:/)
    expect(m.deleted).not.toHaveBeenCalled()
  })
  it('cancellation after current preview prevents the decision claim', async () => {
    const controller = new AbortController()
    m.route.mockReset().mockImplementationOnce(async () => {
      controller.abort()
      return { requiresReview: true, reviewBaseStateHash: 'original-base' }
    })
    await expect(
      rejectServerManagedToolReview('edit_workflow', 'token', {
        ...context,
        signal: controller.signal,
      })
    ).rejects.toThrow('Aborted')
    expect(m.claimed).not.toHaveBeenCalled()
  })
})
