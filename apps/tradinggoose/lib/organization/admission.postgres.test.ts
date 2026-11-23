// Set ORGANIZATION_ADMISSION_TEST_DATABASE_URL to a disposable migrated PostgreSQL database.
import { randomUUID } from 'node:crypto'
import { runWithRequestState } from '@better-auth/core/context'
import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { betterAuth } from 'better-auth'
import { hashPassword } from 'better-auth/crypto'
import { organization } from 'better-auth/plugins'
import { eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { authDatabase } from '@/lib/auth/database'
import { getSeatOccupancy } from '@/lib/billing/validation/seat-management'
import { ssoOptions } from '@/lib/sso/options'
import { PUT as accept } from '@/app/api/organizations/[id]/invitations/[invitationId]/route'
import { POST as batchInvite } from '@/app/api/organizations/[id]/invitations/route'
import { POST as singleInvite } from '@/app/api/organizations/[id]/members/route'
import type { OrganizationTransaction } from './admission'

const databaseUrl = process.env.ORGANIZATION_ADMISSION_TEST_DATABASE_URL
vi.mock('@tradinggoose/db', async () => {
  const schema = await import('@tradinggoose/db/schema')
  const url = process.env.ORGANIZATION_ADMISSION_TEST_DATABASE_URL
  if (!url) return { ...schema, db: {} }
  const { default: postgres } = await vi.importActual<typeof import('postgres')>('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  return { ...schema, db: drizzle(postgres(url, { max: 8 }), { schema }) }
})
const session = vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  vi.stubEnv('BETTER_AUTH_SECRET', 'local-postgres-fixture-secret-for-organization-admission')
  return { user: { id: '' } }
})
vi.mock('@/lib/auth', () => ({ getSession: () => session }))
vi.mock('@/lib/billing/settings', async (original) => ({
  ...(await original<typeof import('@/lib/billing/settings')>()),
  getBillingGateState: () => ({ billingEnabled: true }),
}))
vi.mock('@/lib/email/locale', () => ({ resolveEmailLocale: () => 'en' }))
vi.mock('@/lib/email/mailer', () => ({ sendEmail: () => ({ success: true }) }))
vi.mock('@/components/emails/render-email', () => ({
  getEmailSubject: () => 'Invitation',
  renderInvitationEmail: () => '',
}))

describe.skipIf(!databaseUrl)('PostgreSQL organization admissions', () => {
  const owner = randomUUID()
  const candidate = randomUUID()
  const tier = randomUUID()
  const orgs: string[] = []
  const native = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'local-postgres-fixture-secret-for-organization-admission',
    database: authDatabase,
    plugins: [organization()],
  })
  const email = (id: string) => `${id}@example.test`
  const post = (body: object) =>
    new NextRequest('http://localhost:3000/api/organizations/test', {
      method: 'POST',
      body: JSON.stringify(body),
    })

  beforeAll(async () => {
    await db.insert(schema.user).values(
      [owner, candidate].map((id) => ({
        id,
        name: id,
        email: email(id),
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db.insert(schema.systemBillingTier).values({
      id: tier,
      displayName: 'Seat fixture',
      description: '',
      status: 'active',
      ownerType: 'organization',
      usageScope: 'pooled',
      seatMode: 'adjustable',
      seatCount: 1,
      canConfigureSso: true,
    })
  })
  afterAll(async () => {
    await db.delete(schema.subscription).where(eq(schema.subscription.billingTierId, tier))
    if (orgs.length)
      await db.delete(schema.organization).where(inArray(schema.organization.id, orgs))
    await db.delete(schema.user).where(inArray(schema.user.id, [owner, candidate]))
    await db.delete(schema.systemBillingTier).where(eq(schema.systemBillingTier.id, tier))
    await db.$client.end()
  })
  async function createOrganization(seats: number, withOwner = false) {
    const id = randomUUID()
    orgs.push(id)
    await db.insert(schema.organization).values({ id, name: id, slug: id })
    await db.insert(schema.subscription).values({
      id: randomUUID(),
      plan: tier,
      billingTierId: tier,
      referenceType: 'organization',
      referenceId: id,
      status: 'active',
      seats,
    })
    if (withOwner)
      await db
        .insert(schema.member)
        .values({ id: randomUUID(), userId: owner, organizationId: id, role: 'owner' })
    return id
  }

  // Pause the first writer at its INSERT. The second must wait on the admission lock
  // while reads against the table are still allowed.
  async function overlap<T, U>(
    table: 'member' | 'invitation',
    first: () => Promise<T>,
    second: () => Promise<U>
  ) {
    let results!: Promise<[PromiseSettledResult<T>, PromiseSettledResult<U>]>
    const waitForLock = async (tx: OrganizationTransaction, kind: 'relation' | 'advisory') => {
      await vi.waitFor(
        async () => {
          const [row] = await tx.execute<{ waiting: boolean }>(sql`select exists (
          select 1 from pg_locks where database = (select oid from pg_database where datname = current_database())
          and not granted and locktype = ${kind}
          and (${kind} = 'advisory' or (relation = ${table}::regclass and mode = 'RowExclusiveLock'))
        ) as waiting`)
          expect(row.waiting).toBe(true)
        },
        { timeout: 5000, interval: 10 }
      )
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`lock table ${sql.identifier(table)} in share mode`)
      const a = first()
      void a.catch(() => {})
      await waitForLock(tx, 'relation')
      results = Promise.allSettled([a, second()])
      await waitForLock(tx, 'advisory')
    })
    return results
  }

  const provision = (organizationId: string) =>
    runWithRequestState(new WeakMap(), async () => {
      const { adapter } = await native.$context
      const [user] = await db.select().from(schema.user).where(eq(schema.user.id, candidate))
      const role = await ssoOptions.organizationProvisioning.getRole({
        user,
        userInfo: {},
        provider: {
          providerId: 'fixture',
          issuer: 'https://idp.example.test',
          userId: owner,
          organizationId,
          domain: 'example.test',
        },
      })
      return adapter.create<{
        id: string
        organizationId: string
        userId: string
        role: string
        createdAt: Date
      }>({
        model: 'member',
        data: { organizationId, userId: candidate, role, createdAt: new Date() },
      })
    })

  it('serializes native member inserts for one user across organizations and preserves a repeat admission', async () => {
    const firstOrg = await createOrganization(2)
    const secondOrg = await createOrganization(2)
    const [first, second] = await overlap(
      'member',
      () => provision(firstOrg),
      () => provision(secondOrg)
    )
    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: { status: 'FORBIDDEN' } })
    expect(await provision(firstOrg)).toEqual(first.status === 'fulfilled' && first.value)
    expect(
      await db.select().from(schema.member).where(eq(schema.member.userId, candidate))
    ).toHaveLength(1)
    await db.delete(schema.member).where(eq(schema.member.userId, candidate))
  })

  it('keeps native organization and owner creation together when SSO admits the user first', async () => {
    const { auth, createOrganizationWithAuth } =
      await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
    const slug = randomUUID()
    const create = (cookie = '') =>
      createOrganizationWithAuth(
        new Request('http://localhost:3000/api/auth/organization/create', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000', cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ name: slug, slug }),
        })
      )
    expect((await create()).status).toBe(401)
    const password = randomUUID()
    await db.insert(schema.account).values({
      id: randomUUID(),
      providerId: 'credential',
      userId: candidate,
      accountId: candidate,
      password: await hashPassword(password),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const signedIn = await auth.api.signInEmail({
      body: { email: email(candidate), password },
      asResponse: true,
    })
    expect(signedIn.status).toBe(200)
    const cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const org = await createOrganization(2)
    const [admitted, creation] = await overlap(
      'member',
      () => provision(org),
      () => create(cookie)
    )
    expect(admitted.status).toBe('fulfilled')
    expect(creation).toMatchObject({ status: 'fulfilled', value: { status: 403 } })
    expect(
      await db.select().from(schema.organization).where(eq(schema.organization.slug, slug))
    ).toHaveLength(0)
    await db.delete(schema.member).where(eq(schema.member.userId, candidate))
    const created = await create(cookie)
    expect(created.status).toBe(200)
    const result = await created.json()
    orgs.push(result.id)
    expect(
      await db.select().from(schema.member).where(eq(schema.member.userId, candidate))
    ).toMatchObject([{ organizationId: result.id, role: 'owner' }])
    await db.delete(schema.member).where(eq(schema.member.userId, candidate))
  })

  it.each([
    ['single', singleInvite],
    ['batch', batchInvite],
  ] as const)(
    'reserves the final seat through the %s invitation route before native provisioning',
    async (_name, invite) => {
      session.user.id = owner
      const id = await createOrganization(2, true)
      const recipient = email(randomUUID())
      const [reserved, denied] = await overlap(
        'invitation',
        (): Promise<Response> =>
          invite(
            post({
              email: _name === 'single' ? recipient : undefined,
              emails: [recipient, recipient.toUpperCase()],
            }),
            { params: Promise.resolve({ id }) }
          ),
        () => provision(id)
      )
      expect(reserved).toMatchObject({ status: 'fulfilled', value: { status: 200 } })
      expect(denied).toMatchObject({ status: 'rejected', reason: { status: 'FORBIDDEN' } })
      expect(await getSeatOccupancy(id)).toEqual({ members: 1, pending: 1, occupied: 2 })
    }
  )

  it('keeps the last seat for a native member while an invitation waits for its INSERT', async () => {
    session.user.id = owner
    const id = await createOrganization(2, true)
    const [admitted, denied] = await overlap(
      'member',
      () => provision(id),
      () => singleInvite(post({ email: email(randomUUID()) }), { params: Promise.resolve({ id }) })
    )
    expect(admitted.status).toBe('fulfilled')
    expect(denied).toMatchObject({ status: 'fulfilled', value: { status: 400 } })
    expect(await getSeatOccupancy(id)).toEqual({ members: 2, pending: 0, occupied: 2 })
    await db.delete(schema.member).where(eq(schema.member.userId, candidate))
  })

  it('returns the same membership for simultaneous native provisioning in one organization', async () => {
    const id = await createOrganization(1)
    const [first, second] = await overlap(
      'member',
      () => provision(id),
      () => provision(id)
    )
    expect(first.status).toBe('fulfilled')
    expect(second).toEqual(first)
    expect(await getSeatOccupancy(id)).toEqual({ members: 1, pending: 0, occupied: 1 })
    await db.delete(schema.member).where(eq(schema.member.userId, candidate))
  })

  it('converts a reserved seat once across overlapping acceptance requests', async () => {
    const id = await createOrganization(2, true)
    const invitationId = randomUUID()
    await db.insert(schema.invitation).values({
      id: invitationId,
      organizationId: id,
      inviterId: owner,
      email: email(candidate),
      role: 'admin',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60000),
    })
    session.user.id = candidate
    const confirm = () =>
      accept(post({ status: 'accepted' }), { params: Promise.resolve({ id, invitationId }) })
    const [first, second] = await overlap('member', confirm, confirm)
    expect(first).toMatchObject({ status: 'fulfilled', value: { status: 200 } })
    expect(second).toMatchObject({ status: 'fulfilled', value: { status: 400 } })
    expect(await getSeatOccupancy(id)).toEqual({ members: 2, pending: 0, occupied: 2 })
  })
})
