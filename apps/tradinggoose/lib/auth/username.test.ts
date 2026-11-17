import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { testUtils, type username } from 'better-auth/plugins'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const policy = vi.hoisted(() => ({ allowedDomains: '' }))
vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('@/lib/env', async (original) => {
  const actual = await original<typeof import('@/lib/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      ALLOWED_LOGIN_EMAILS: '',
      get ALLOWED_LOGIN_DOMAINS() {
        return policy.allowedDomains
      },
    },
  }
})

import { auth as productionAuth } from '@/lib/auth'

// Adapted from Better Auth v1.6.34 packages/better-auth/src/plugins/username/username.test.ts.
const email = 'owner@example.com'
const password = 'native-username-password-123'
const signupBody = { email, password, name: 'Account owner', username: 'Mixed.Name' }
const baseURL = 'http://localhost:3000'

async function setup(requireEmailVerification = false) {
  const options: BetterAuthOptions = productionAuth.options
  const plugin = options.plugins?.find((plugin) => plugin.id === 'username') as
    | ReturnType<typeof username>
    | undefined
  if (!plugin) throw new Error('The production username plugin is required')
  const auth = betterAuth({
    baseURL,
    secret: 'native-username-test-secret-long-enough',
    user: options.user,
    account: options.account,
    session: options.session,
    emailAndPassword: { ...productionAuth.options.emailAndPassword, requireEmailVerification },
    emailVerification: options.emailVerification,
    hooks: { before: options.hooks?.before },
    databaseHooks: { session: options.databaseHooks?.session },
    plugins: [plugin, testUtils()],
  })
  const { response: signup, headers: responseHeaders } = await auth.api.signUpEmail({
    body: signupBody,
    returnHeaders: true,
  })
  const headers = new Headers({
    cookie: responseHeaders
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
  })
  const context = await auth.$context
  const sessions = await context.internalAdapter.listSessions(signup.user.id)
  return { auth, context, user: signup.user, headers, sessions }
}

beforeEach(() => {
  policy.allowedDomains = ''
})

describe('native username authentication', () => {
  it('preserves chosen casing while accepting username and email password login', async () => {
    const { auth, user } = await setup()
    expect(user).toMatchObject({ username: 'mixed.name', displayUsername: 'Mixed.Name' })
    await expect(
      auth.api.signInUsername({ body: { username: 'MIXED.NAME', password } })
    ).resolves.toMatchObject({ user: { id: user.id }, token: expect.any(String) })
    await expect(auth.api.signInEmail({ body: { email, password } })).resolves.toMatchObject({
      user: { id: user.id },
      token: expect.any(String),
    })
  })

  it('rejects a wrong password without creating a session', async () => {
    const { auth, context, user, sessions } = await setup()
    await expect(
      auth.api.signInUsername({
        body: { username: signupBody.username, password: 'wrong-password' },
      })
    ).rejects.toMatchObject({ statusCode: 401, body: { code: 'INVALID_USERNAME_OR_PASSWORD' } })
    await expect(context.internalAdapter.listSessions(user.id)).resolves.toEqual(sessions)
  })

  it.each([
    ['MIXED.NAME', 'USERNAME_IS_ALREADY_TAKEN'],
    ['invalid username', 'INVALID_USERNAME'],
  ])('rejects signup username %s', async (username, code) => {
    const { auth } = await setup()
    await expect(
      auth.api.signUpEmail({ body: { ...signupBody, email: 'other@example.com', username } })
    ).rejects.toMatchObject({ statusCode: 400, body: { code } })
  })

  it('checks availability natively and treats existing usernames as taken regardless of case', async () => {
    const { auth, headers } = await setup()
    await expect(
      auth.api.isUsernameAvailable({ body: { username: 'New.Handle' } })
    ).resolves.toEqual({ available: true })
    await expect(
      auth.api.isUsernameAvailable({ headers, body: { username: 'MIXED.NAME' } })
    ).resolves.toEqual({ available: false })
  })

  it('retains required email verification before username password login', async () => {
    const { auth, context, user } = await setup(true)
    await expect(
      auth.api.signInUsername({ body: { username: signupBody.username, password } })
    ).rejects.toMatchObject({ statusCode: 403, body: { code: 'EMAIL_NOT_VERIFIED' } })
    await expect(context.internalAdapter.listSessions(user.id)).resolves.toEqual([])
  })

  it.each([undefined, 'allowed@allowed.example'])(
    'enforces the stored email allowlist when the username request supplies email %s',
    async (forgedEmail) => {
      const { auth, context, user, sessions } = await setup()
      policy.allowedDomains = 'allowed.example'
      const response = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-in/username`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: signupBody.username, password, email: forgedEmail }),
        })
      )
      expect(response.status).toBe(403)
      await expect(context.internalAdapter.listSessions(user.id)).resolves.toEqual(sessions)
    }
  )

  it('uses the current account email when enforcing username sign-in policy', async () => {
    const { auth, context, user } = await setup()
    await context.internalAdapter.updateUser(user.id, { email: 'changed@allowed.example' })
    policy.allowedDomains = 'allowed.example'
    await expect(
      auth.api.signInUsername({ body: { username: signupBody.username, password } })
    ).resolves.toMatchObject({ user: { id: user.id, email: 'changed@allowed.example' } })
  })

  it.each([undefined, ''])(
    'requires a chosen username for password signup (%s)',
    async (username) => {
      const { auth } = await setup()
      await expect(
        auth.api.signUpEmail({ body: { ...signupBody, email: 'other@example.com', username } })
      ).rejects.toMatchObject({ statusCode: 400, body: { code: 'USERNAME_REQUIRED' } })
    }
  )

  it('does not derive a username for a social-style user record', async () => {
    const { context } = await setup()
    await context.test.saveUser(
      context.test.createUser({ id: 'social', email: 'social@example.com' })
    )
    const stored = await context.internalAdapter.findUserById('social')
    expect(stored).toMatchObject({ id: 'social' })
    expect(stored).not.toHaveProperty('username', expect.anything())
    expect(stored).not.toHaveProperty('displayUsername', expect.anything())
  })

  it('supports native authenticated username changes and rejects another account’s username', async () => {
    const { auth, user, headers } = await setup()
    await auth.api.updateUser({
      headers,
      body: { username: 'First.Choice', displayUsername: 'First.Choice' },
    })
    await auth.api.updateUser({
      headers,
      body: { username: 'Second.Choice', displayUsername: 'Second.Choice' },
    })
    await expect(
      auth.api.signInUsername({ body: { username: 'SECOND.CHOICE', password } })
    ).resolves.toMatchObject({
      user: { id: user.id, username: 'second.choice', displayUsername: 'Second.Choice' },
    })
    await expect(
      auth.api.signInUsername({ body: { username: 'first.choice', password } })
    ).rejects.toMatchObject({ body: { code: 'INVALID_USERNAME_OR_PASSWORD' } })
    await auth.api.signUpEmail({ body: { ...signupBody, email: 'other@example.com' } })
    await expect(
      auth.api.updateUser({ headers, body: { username: 'MIXED.NAME' } })
    ).rejects.toMatchObject({ body: { code: 'USERNAME_IS_ALREADY_TAKEN' } })
  })
})
