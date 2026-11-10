/** @vitest-environment node */
import { verification } from '@tradinggoose/db/schema'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Actual SQL token CAS on the existing NEW owned payload-only operator fixture.
// Business preview/effect and encryption are explicit synthetic seams, not financial,
// restricted-role, authenticated-route, native-service, or end-to-end business proof.
const fixture = vi.hoisted(() => {
  const url = process.env.MASTRA_TEST_DATABASE_URL
  const database = process.env.SOURCE_MEMORY_DATABASE
  const marker = process.env.SOURCE_MEMORY_MARKER
  if (url) {
    const parsed = new URL(url)
    if (
      process.env.SOURCE_MEMORY_TEST_OPT_IN !== 'six-findings-synthetic-memory-only' ||
      !/^six_memory_[0-9a-f]{12}_disposable$/.test(database ?? '') ||
      !/^six-memory-source-owned:[0-9a-f]{24}$/.test(marker ?? '') ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== process.env.SOURCE_MEMORY_PORT ||
      parsed.username !== 'postgres' ||
      parsed.pathname !== `/${database}`
    )
      throw new Error('Explicit NEW owned payload-only token fixture required')
  }
  return {
    url,
    database,
    marker,
    client: undefined as import('postgres').Sql | undefined,
    route: vi.fn(),
  }
})
vi.mock('@tradinggoose/db', async () => {
  if (!fixture.url) return { db: {} }
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  fixture.client = postgres(fixture.url, {
    max: 2,
    prepare: false,
    connection: { application_name: 'r8-review-token-owned-fixture', statement_timeout: 1000 },
  })
  return { db: drizzle(fixture.client) }
})
vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: fixture.route }))
vi.mock('@/lib/utils-server', () => ({
  encryptSecret: async (value: string) => ({ encrypted: value }),
  decryptSecret: async (value: string) => ({ decrypted: value }),
}))

import { hashServerToolReviewBase } from './base-tool'
import {
  acceptServerManagedToolReview,
  rejectServerManagedToolReview,
  stageServerManagedToolReview,
} from './review-acceptance'

const tests = fixture.url ? describe : describe.skip
tests('owned payload fixture: actual server review token CAS', () => {
  const tokens = new Set<string>()
  const tasks = new Set<Promise<unknown>>()
  const releases = new Set<() => void>()
  let accepting = true
  let owned = false
  let mutations = 0
  const base = hashServerToolReviewBase({ existing: 'synthetic current business state' })
  const context = {
    userId: 'synthetic-token-actor',
    workspaceId: 'original-business-workspace',
    contextEntityKind: 'workflow' as const,
    contextEntityId: 'original-workflow',
    nativeReviewBinding: 'synthetic-original-target-args-financial-occurrence-digest',
  }
  const args = { entityId: 'original-workflow', entityDocument: 'synthetic proposed document' }
  const preview = () => ({ requiresReview: true, reviewBaseStateHash: base })
  function sqlClient() {
    if (!fixture.client) throw new Error('Owned token client is unavailable')
    return fixture.client
  }
  function track<T>(run: () => Promise<T>): Promise<T> {
    if (!accepting) throw new Error('Token fixture admission is closed')
    const task = Promise.resolve().then(run)
    tasks.add(task)
    void task.then(
      () => tasks.delete(task),
      () => tasks.delete(task)
    )
    return task
  }
  function gate() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    const release = () => {
      releases.delete(release)
      resolve()
    }
    releases.add(release)
    return { promise, release }
  }
  async function stage() {
    const result = await track(() =>
      stageServerManagedToolReview('edit_workflow', args, preview(), context)
    )
    if (
      !result ||
      typeof result !== 'object' ||
      !('reviewToken' in result) ||
      typeof result.reviewToken !== 'string'
    )
      throw new Error('Actual staged token was not returned')
    tokens.add(result.reviewToken)
    return result.reviewToken
  }
  beforeAll(async () => {
    const client = sqlClient()
    const identity = await client<
      { database: string; actor: string; owner: string; marker: string }[]
    >`
      select current_database() as database, current_user as actor, pg_get_userbyid(datdba) as owner, shobj_description(oid, 'pg_database') as marker
      from pg_database where datname=current_database()
    `
    if (
      identity.length !== 1 ||
      identity[0].database !== fixture.database ||
      identity[0].actor !== 'postgres' ||
      identity[0].owner !== 'postgres' ||
      identity[0].marker !== fixture.marker
    )
      throw new Error('Exact NEW owned token database marker mismatch')
    owned = true
    const config = getTableConfig(verification)
    if (config.name !== 'verification') throw new Error('Canonical token table mismatch')
    const columns = config.columns.map((column) => {
      if (!/^[a-z_]+$/.test(column.name)) throw new Error('Unexpected canonical token column')
      const type = column.getSQLType()
      if (!/^(text|timestamp)/.test(type))
        throw new Error('Unsupported canonical token fixture column')
      return `"${column.name}" ${type}${column.notNull ? ' not null' : ''}${column.primary ? ' primary key' : ''}`
    })
    await client.unsafe(`create table if not exists "${config.name}" (${columns.join(',')})`)
  })
  beforeEach(() => {
    fixture.route.mockReset()
    mutations = 0
    fixture.route.mockImplementation(async (_name, _args, executionContext) => {
      if (executionContext.accessLevel === 'limited') return preview()
      mutations++
      return { success: true }
    })
  })
  afterEach(async () => {
    for (const release of [...releases]) release()
    await Promise.allSettled([...tasks])
  })
  afterAll(async () => {
    accepting = false
    for (const release of [...releases]) release()
    await Promise.allSettled([...tasks])
    try {
      if (owned) {
        const client = sqlClient()
        for (const token of tokens)
          await client`delete from verification where identifier=${`copilot-tool-review:${token}`}`
      }
    } finally {
      await fixture.client?.end({ timeout: 2 })
    }
  }, 20000)

  it.each(['accept', 'reject'] as const)(
    'one original-value claim wins with %s released first',
    async (winner) => {
      const token = await stage()
      const firstEntered = gate()
      const secondEntered = gate()
      const firstRelease = gate()
      const secondRelease = gate()
      let previews = 0
      fixture.route.mockImplementation(async (_name, _args, executionContext) => {
        if (executionContext.accessLevel === 'limited') {
          if (++previews === 1) {
            firstEntered.release()
            await firstRelease.promise
          } else {
            secondEntered.release()
            await secondRelease.promise
          }
          return preview()
        }
        mutations++
        return { success: true }
      })
      const accept = () => acceptServerManagedToolReview('edit_workflow', token, context)
      const reject = () => rejectServerManagedToolReview('edit_workflow', token, context)
      const first = track(winner === 'accept' ? accept : reject)
      const firstOutcome = Promise.allSettled([first])
      await firstEntered.promise
      const second = track(winner === 'accept' ? reject : accept)
      const secondOutcome = Promise.allSettled([second])
      await secondEntered.promise // BOTH read the same original real row before either CAS.
      firstRelease.release()
      const won = (await firstOutcome)[0]
      expect(won.status).toBe('fulfilled')
      if (won.status === 'fulfilled' && winner === 'reject')
        expect(won.value).toEqual({ success: false, rejected: true, toolName: 'edit_workflow' })
      secondRelease.release()
      expect((await secondOutcome)[0].status).toBe('rejected')
      expect(mutations).toBe(winner === 'accept' ? 1 : 0)
      const client = sqlClient()
      expect(
        await client`select id from verification where identifier=${`copilot-tool-review:${token}`}`
      ).toHaveLength(0)
    }
  )

  it('an applied Accept with a lost reply leaves an unusable claim rather than a reusable Reject token', async () => {
    const token = await stage()
    fixture.route.mockImplementation(async (_name, _args, executionContext) => {
      if (executionContext.accessLevel === 'limited') return preview()
      mutations++
      throw new Error('Synthetic applied effect reply lost')
    })
    await expect(
      track(() => acceptServerManagedToolReview('edit_workflow', token, context))
    ).rejects.toThrow('reply lost')
    const client = sqlClient()
    const rows = await client<
      { value: string }[]
    >`select value from verification where identifier=${`copilot-tool-review:${token}`}`
    expect(rows).toHaveLength(1)
    expect(rows[0].value).toMatch(/^claimed:/)
    await expect(
      track(() => rejectServerManagedToolReview('edit_workflow', token, context))
    ).rejects.toThrow('invalid or expired')
    expect(mutations).toBe(1)
  })

  it('expiry during awaited preview is rechecked by the real decision CAS', async () => {
    const token = await stage()
    const entered = gate()
    const release = gate()
    fixture.route.mockImplementation(async () => {
      entered.release()
      await release.promise
      return preview()
    })
    const rejecting = track(() => rejectServerManagedToolReview('edit_workflow', token, context))
    const outcome = Promise.allSettled([rejecting])
    await entered.promise
    const client = sqlClient()
    await client`update verification set expires_at=now()-interval '1 second' where identifier=${`copilot-tool-review:${token}`}`
    release.release()
    expect((await outcome)[0].status).toBe('rejected')
    expect(mutations).toBe(0)
    const rows = await client<
      { value: string }[]
    >`select value from verification where identifier=${`copilot-tool-review:${token}`}`
    expect(rows).toHaveLength(1)
    expect(rows[0].value).not.toMatch(/^claimed:/)
  })

  it('wrong actor, original native binding or business context cannot consume the real row', async () => {
    const token = await stage()
    for (const changed of [
      { ...context, userId: 'other-actor' },
      { ...context, nativeReviewBinding: 'other-target-occurrence' },
      { ...context, workspaceId: 'other-business-workspace' },
    ])
      await expect(
        track(() => rejectServerManagedToolReview('edit_workflow', token, changed))
      ).rejects.toThrow('does not match')
    expect(fixture.route).not.toHaveBeenCalled()
    const result = await track(() => rejectServerManagedToolReview('edit_workflow', token, context))
    expect(result).toEqual({ success: false, rejected: true, toolName: 'edit_workflow' })
    expect(mutations).toBe(0)
  })
})
