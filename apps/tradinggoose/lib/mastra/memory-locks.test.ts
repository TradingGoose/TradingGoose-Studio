import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { MemoryReadBudget } from './memory-budget'
import { lockMemoryHierarchy, lockMemoryKeys, type MemoryTransaction } from './memory-locks'

// SQL dispatch/order model only; real lock contention and holder lifetimes require PostgreSQL.
function fixture() {
  let now = 0
  let advance: (query: { sql: string; params: unknown[] }) => void = () => {}
  const queries: { sql: string; params: unknown[] }[] = []
  const execute = vi.fn()
  execute.mockImplementation(async (input: SQL) => {
    const query = new PgDialect().sqlToQuery(input)
    queries.push(query)
    advance(query)
    return []
  })
  const tx: MemoryTransaction = { execute, select: vi.fn() }
  const budget = new MemoryReadBudget(10000, undefined, () => now)
  return {
    tx,
    budget,
    queries,
    setNow: (value: number) => {
      now = value
    },
    advanceWith: (run: typeof advance) => {
      advance = run
    },
    addTime: (value: number) => {
      now += value
    },
  }
}

describe('existing Memory hierarchy and one cumulative acquisition deadline', () => {
  it('returns the actual original deadline and retains existing list/owner/key order', async () => {
    const f = fixture()
    await expect(
      lockMemoryHierarchy(f.tx, 'workspace', 'workflow', 'only-key', f.budget, 5000)
    ).resolves.toBe(500)
    expect(
      f.queries.filter((query) => query.sql.includes('pg_advisory_xact_lock')).map((q) => q.params)
    ).toEqual([
      ['workflow:workspace'],
      [1904202617, JSON.stringify(['workflow-memory-owner', 'workspace', 'workflow'])],
      [1904202617, JSON.stringify(['workflow-memory-key', 'workspace', 'workflow', 'only-key'])],
    ])
  })

  it('sorts all discovered keys after list/owner and shares elapsed enumeration time', async () => {
    const f = fixture()
    f.advanceWith(() => f.addTime(100))
    const acquireUntil = await lockMemoryHierarchy(
      f.tx,
      'workspace',
      'workflow',
      undefined,
      f.budget,
      5000
    )
    expect(acquireUntil).toBe(500)
    f.setNow(410)
    f.advanceWith(() => f.addTime(20))
    await lockMemoryKeys(f.tx, 'workspace', 'workflow', ['b', 'a', 'b'], f.budget, acquireUntil)
    expect(
      f.queries
        .filter((query) => query.sql.includes("set_config('lock_timeout'"))
        .map((q) => q.params)
    ).toEqual([['500'], ['300'], ['90'], ['50']])
    expect(
      f.queries.filter((query) => query.sql.includes('pg_advisory_xact_lock')).map((q) => q.params)
    ).toEqual([
      ['workflow:workspace'],
      [1904202617, JSON.stringify(['workflow-memory-owner', 'workspace', 'workflow'])],
      [1904202617, JSON.stringify(['workflow-memory-key', 'workspace', 'workflow', 'a'])],
      [1904202617, JSON.stringify(['workflow-memory-key', 'workspace', 'workflow', 'b'])],
    ])
  })

  it('refuses all discovered-key dispatch when enumeration has consumed the original 500ms', async () => {
    const f = fixture()
    const acquireUntil = await lockMemoryHierarchy(
      f.tx,
      'workspace',
      'workflow',
      undefined,
      f.budget,
      5000
    )
    const before = f.queries.length
    f.setNow(500)
    await expect(
      lockMemoryKeys(f.tx, 'workspace', 'workflow', ['key'], f.budget, acquireUntil)
    ).rejects.toMatchObject({ status: 503 })
    expect(f.queries).toHaveLength(before)
  })

  it('checks the same deadline after a setter and never dispatches the next key after expiry', async () => {
    const f = fixture()
    const acquireUntil = await lockMemoryHierarchy(
      f.tx,
      'workspace',
      'workflow',
      undefined,
      f.budget,
      5000
    )
    f.setNow(450)
    f.advanceWith((query) => {
      if (query.sql.includes('pg_advisory_xact_lock')) f.setNow(490)
      else if (query.params[0] === '10') f.setNow(500)
    })
    await expect(
      lockMemoryKeys(f.tx, 'workspace', 'workflow', ['b', 'a'], f.budget, acquireUntil)
    ).rejects.toMatchObject({ status: 503 })
    const keys = f.queries.filter((query) =>
      query.params.some(
        (param) => typeof param === 'string' && param.includes('workflow-memory-key')
      )
    )
    expect(keys.map((query) => query.params)).toEqual([
      [1904202617, JSON.stringify(['workflow-memory-key', 'workspace', 'workflow', 'a'])],
    ])
  })

  it('inherits cancellation before any discovered-key contact', async () => {
    const f = fixture()
    const abort = new AbortController()
    const budget = new MemoryReadBudget(10000, abort.signal, () => 0)
    const acquireUntil = await lockMemoryHierarchy(
      f.tx,
      'workspace',
      'workflow',
      undefined,
      budget,
      5000
    )
    const before = f.queries.length
    abort.abort()
    await expect(
      lockMemoryKeys(f.tx, 'workspace', 'workflow', ['key'], budget, acquireUntil)
    ).rejects.toMatchObject({ status: 503 })
    expect(f.queries).toHaveLength(before)
  })
})
