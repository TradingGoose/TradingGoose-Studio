import { runWithRequestState } from '@better-auth/core/context'
import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { authDatabase } from '@/lib/auth/database'
import { ssoAdmission } from '@/lib/sso/options'
import { PUT as accept } from '@/app/api/organizations/[id]/invitations/[invitationId]/route'
import { withOrganizationAdmission } from './admission'

const { transaction, seats, tables } = vi.hoisted(() => ({
  transaction: vi.fn(),
  seats: vi.fn(),
  tables: { member: [], invitation: [] } as Record<string, Record<string, unknown>[]>,
}))
vi.mock('@tradinggoose/db', async () => ({
  ...(await import('@tradinggoose/db/schema')),
  db: { transaction },
}))
vi.mock('better-auth/adapters/drizzle', async () => {
  const { memoryAdapter } = await import('better-auth/adapters/memory')
  return { drizzleAdapter: () => memoryAdapter(tables) }
})
vi.mock('@/lib/billing/validation/seat-management', () => ({ validateSeatAvailability: seats }))
vi.mock('@/lib/sso/management', () => ({
  requireOrganizationSsoEnabled: async () => ({ billingEnabled: true }),
}))
vi.mock('@/lib/auth', () => ({ getSession: async () => ({ user: { id: 'user' } }) }))

const execute = vi.fn<(statement: SQL) => Promise<void>>()
const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  secret: 'organization-admission-test-fixture-secret',
  database: authDatabase,
  plugins: [organization()],
})

beforeEach(() => {
  tables.member.length = 0
  tables.invitation.length = 0
  execute.mockReset().mockResolvedValue(undefined)
  transaction.mockReset().mockImplementation((write) => write({ execute }))
  seats.mockReset().mockResolvedValue({ canInvite: true })
})

it('awaits the user and organization locks in order before admitting the writer', async () => {
  let release!: () => void
  const lock = new Promise<void>((resolve) => {
    release = resolve
  })
  execute.mockResolvedValueOnce(undefined).mockReturnValueOnce(lock)
  const write = vi.fn(async () => 'admitted')
  const result = withOrganizationAdmission({ userId: 'user', organizationId: 'org' }, write)
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
  const queries = execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement))
  expect(queries.map(({ sql }) => sql)).toEqual(
    Array(2).fill('select pg_advisory_xact_lock($1, hashtext($2))')
  )
  const [userLock, orgLock] = queries.map(({ params }) => params)
  expect(userLock[1]).toBe('user')
  expect(orgLock[1]).toBe('org')
  expect(userLock[0]).not.toBe(orgLock[0])
  expect(write).not.toHaveBeenCalled()
  release()
  await expect(result).resolves.toBe('admitted')
  expect(write).toHaveBeenCalledExactlyOnceWith({ execute })
})

it('reuses membership in the same organization and refuses a different organization', async () => {
  const { adapter } = await auth.$context
  const join = (organizationId: string) =>
    adapter.create({
      model: 'member',
      data: { userId: 'user', organizationId, role: 'member', createdAt: new Date() },
    })
  const member = await join('first')
  await expect(join('first')).resolves.toEqual(member)
  await expect(join('second')).rejects.toMatchObject({ status: 'FORBIDDEN' })
  expect(tables.member).toHaveLength(1)
  expect(seats).toHaveBeenCalledOnce()
})

it('preserves a pending invitation and refuses native provisioning when the last seat is occupied', async () => {
  const { adapter } = await auth.$context
  const identity = { organizationId: 'org', userId: 'user', email: 'user@example.test' }
  const provision = () =>
    runWithRequestState(new WeakMap(), async () => {
      await ssoAdmission.set(identity)
      return adapter.create({
        model: 'member',
        data: { ...identity, role: 'member', createdAt: new Date() },
      })
    })
  tables.invitation.push({
    ...identity,
    id: 'invitation',
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
  })
  await expect(provision()).rejects.toMatchObject({ status: 'CONFLICT' })
  expect(seats).not.toHaveBeenCalled()
  tables.invitation.length = 0
  seats.mockResolvedValue({ canInvite: false, reason: 'No available seats' })
  await expect(provision()).rejects.toMatchObject({ status: 'FORBIDDEN' })
  expect(tables.member).toHaveLength(0)
})

it('converts a reserved seat to membership once when acceptance is retried', async () => {
  const invite = { id: 'invite', email: 'guest@example.com', role: 'admin', status: 'pending' }
  const where = vi
    .fn()
    .mockReturnValueOnce({ for: async () => [invite] })
    .mockResolvedValueOnce([{ email: invite.email }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockReturnValueOnce({ for: async () => [{ ...invite, status: 'accepted' }] })
  const values = vi.fn(() => ({ onConflictDoNothing: vi.fn() }))
  const set = vi.fn(() => ({ where: vi.fn() }))
  transaction.mockImplementation((callback) =>
    callback({
      execute,
      select: () => ({ from: () => ({ where }) }),
      insert: () => ({ values }),
      update: () => ({ set }),
    })
  )
  const confirm = () =>
    accept(
      new NextRequest('http://localhost/api/invitation', {
        method: 'PUT',
        body: JSON.stringify({ status: 'accepted' }),
      }),
      { params: Promise.resolve({ id: 'org', invitationId: invite.id }) }
    )
  expect((await confirm()).status).toBe(200)
  expect((await confirm()).status).toBe(400)
  expect(set).toHaveBeenCalledExactlyOnceWith({ status: 'accepted' })
  expect(values.mock.calls).toEqual([
    [expect.objectContaining({ userId: 'user', organizationId: 'org', role: 'admin' })],
    [{ userId: 'user', organizationId: 'org' }],
  ])
})
