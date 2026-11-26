import { environmentVariables } from '@tradinggoose/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, expect, it, vi } from 'vitest'
import { setEnvironmentVariablesServerTool as tool } from './set-environment-variables'

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn(), access: vi.fn() }))
vi.mock('@tradinggoose/db', () => ({
  db: { transaction: mocks.transaction, select: mocks.select },
}))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  verifyWorkspaceContext: mocks.access,
}))
vi.mock('@/lib/utils-server', () => ({
  encryptSecret: async (value: string) => ({ encrypted: `encrypted-${value}` }),
}))

beforeEach(() => {
  vi.resetAllMocks()
})

it.each([
  ['personal', 'rotated'],
  ['workspace', 'created'],
  ['workspace', 'deleted'],
] as const)('rolls back a %s batch when its target is concurrently %s', async (scope, change) => {
  const workspaceId = scope === 'workspace' ? 'space' : undefined
  const targetId = workspaceId ?? 'actor'
  const scopeColumn = workspaceId ? environmentVariables.workspaceId : environmentVariables.userId
  const args = {
    scope,
    ...(workspaceId ? { workspaceId } : {}),
    variables: { A: 'first', Z: 'last' },
  }
  const context = { userId: 'actor', workspaceId, accessLevel: 'full' as const }
  const values = new Map([['A', 'first-base']])
  if (change !== 'created') values.set('Z', 'reviewed')
  const dialect = new PgDialect()
  const intervene = vi.fn().mockImplementationOnce(() => {
    if (change === 'deleted') values.delete('Z')
    else values.set('Z', 'other-editor')
  })
  const select = () => ({
    from: () => ({
      where: (condition: SQL) => {
        const query = dialect.sqlToQuery(condition)
        expect(query.sql).toContain(`"${scopeColumn.name}" = $1`)
        expect(query.params).toEqual([targetId])
        return Array.from(values, ([key, value]) => ({ key, value }))
      },
    }),
  })
  mocks.select.mockImplementation(select)
  const pending = new Map<string, string>()
  mocks.transaction.mockImplementation(async (run) => {
    pending.clear()
    const result = await run({
      select,
      update: () => ({
        set: ({ value }: { value: string }) => ({
          where: (condition: SQL) => ({
            returning: () => {
              const query = dialect.sqlToQuery(condition)
              expect(query.sql).toContain(`"${scopeColumn.name}" = $1`)
              expect(query.sql).toContain('"key" = $2')
              expect(query.sql).toContain('"value" = $3')
              const [owner, key, previous] = query.params as string[]
              expect(owner).toBe(targetId)
              if (key === 'Z') intervene()
              if (values.get(key) !== previous) return []
              pending.set(key, value)
              return [{ id: key }]
            },
          }),
        }),
      }),
      insert: () => ({
        values: (row: { key: string; value: string; workspaceId?: string; userId?: string }) => {
          expect([row.workspaceId, row.userId]).toEqual([
            workspaceId,
            workspaceId ? undefined : 'actor',
          ])
          if (row.key === 'Z') intervene()
          return {
            onConflictDoNothing: ({ target }: { target: unknown[] }) => ({
              returning: () => {
                expect(target).toEqual([scopeColumn, environmentVariables.key])
                if (values.has(row.key)) return []
                pending.set(row.key, row.value)
                return [{ id: row.key }]
              },
            }),
            onConflictDoUpdate: () => {
              pending.set(row.key, row.value)
            },
          }
        },
      }),
    })
    for (const [key, value] of pending) values.set(key, value)
    return result
  })
  const preview = await tool.execute(args, { ...context, accessLevel: 'limited' })
  expect(preview.requiresReview).toBe(true)
  expect(mocks.transaction).not.toHaveBeenCalled()
  const accept = (acceptedReviewBaseStateHash: string) =>
    tool.execute(args, { ...context, acceptedReviewBaseStateHash })
  await expect(accept(preview.reviewBaseStateHash)).rejects.toMatchObject({
    status: 409,
    code: 'stale_server_tool_review',
  })
  expect(mocks.select).toHaveBeenCalledOnce()
  expect(pending.has('A')).toBe(true)
  expect(values.get('A')).toBe('first-base')
  expect(values.get('Z')).toBe(change === 'deleted' ? undefined : 'other-editor')
  await expect(accept(preview.reviewBaseStateHash)).rejects.toMatchObject({ status: 409 })
  const fresh = await tool.execute(args, { ...context, accessLevel: 'limited' })
  values.set('UNRELATED', 'independent')
  await expect(accept(fresh.reviewBaseStateHash)).resolves.toMatchObject({
    success: true,
    variableCount: 2,
  })
  expect(Object.fromEntries(values)).toEqual({
    A: 'encrypted-first',
    Z: 'encrypted-last',
    UNRELATED: 'independent',
  })
  await expect(
    tool.execute({ ...args, variables: { Z: 'ordinary' } }, context)
  ).resolves.toMatchObject({ success: true })
  expect(values.get('Z')).toBe('encrypted-ordinary')
  if (workspaceId)
    expect(mocks.access).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actor', workspaceId }),
      'write'
    )
})

it('denies a workspace edit before reading or writing secrets', async () => {
  mocks.access.mockRejectedValue(new Error('Access denied'))
  await expect(
    tool.execute(
      { scope: 'workspace', workspaceId: 'space', variables: { Z: 'new' } },
      { userId: 'reader', accessLevel: 'full', acceptedReviewBaseStateHash: 'saved' }
    )
  ).rejects.toThrow('Access denied')
  expect(mocks.select).not.toHaveBeenCalled()
  expect(mocks.transaction).not.toHaveBeenCalled()
})
