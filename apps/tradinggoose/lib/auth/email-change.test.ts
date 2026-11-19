import { stripe } from '@better-auth/stripe'
import { db } from '@tradinggoose/db'
import { member, systemSettings, waitlist } from '@tradinggoose/db/schema'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createAuthClient } from 'better-auth/client'
import { emailOTPClient } from 'better-auth/client/plugins'
import { applySetCookies } from 'better-auth/cookies'
import { emailOTP, testUtils, username } from 'better-auth/plugins'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mail, policy } = vi.hoisted(() => ({
  mail: {
    available: vi.fn(),
    send: vi.fn(),
    audience: vi.fn(),
  },
  policy: { allowedDomains: '' },
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })),
    transaction: vi.fn(),
  },
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
vi.mock('@/lib/email/locale', async (original) => ({
  ...(await original<typeof import('@/lib/email/locale')>()),
  resolveEmailLocale: async () => 'en',
}))
vi.mock('@/lib/email/mailer', async (original) => ({
  ...(await original<typeof import('@/lib/email/mailer')>()),
  sendEmail: mail.send,
  hasEmailService: mail.available,
  addVerifiedUserEmailToAudience: mail.audience,
}))

import { auth as productionAuth } from '@/lib/auth'

async function setup(
  email = 'owner@example.com',
  emailVerified = true,
  requireEmailVerification = false
) {
  const productionOptions: BetterAuthOptions = productionAuth.options
  const productionOtp = productionAuth.options.plugins.find((plugin) => plugin.id === 'email-otp')
  if (!productionOtp) throw new Error('The email OTP plugin is required')
  let sequence = 100000
  const customerUpdate = vi.fn().mockResolvedValue({ id: 'cus-owner' })
  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'email-change-test-secret-that-is-long-enough',
    database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
    user: productionOptions.user,
    emailAndPassword: {
      ...productionAuth.options.emailAndPassword,
      requireEmailVerification,
    },
    session: productionAuth.options.session,
    hooks: productionAuth.options.hooks,
    databaseHooks: { user: { update: productionAuth.options.databaseHooks.user.update } },
    emailVerification: productionAuth.options.emailVerification,
    plugins: [
      username(),
      emailOTP({ ...productionOtp.options, generateOTP: () => String(++sequence) }),
      stripe({
        stripeClient: {
          customers: {
            retrieve: vi.fn().mockResolvedValue({ id: 'cus-owner', email }),
            update: customerUpdate,
          },
        } as unknown as Stripe,
        stripeWebhookSecret: 'webhook-test-secret',
        subscription: { enabled: true, plans: [] },
      }),
      testUtils(),
    ],
  })
  const context = await auth.$context
  await context.test.saveUser(context.test.createUser({ id: 'owner', email, emailVerified }))
  await context.adapter.update({
    model: 'user',
    where: [{ field: 'id', value: 'owner' }],
    update: { stripeCustomerId: 'cus-owner' },
  })
  const login = await context.test.login({ userId: 'owner' })
  return { auth, context, login, customerUpdate, email }
}

type Fixture = Awaited<ReturnType<typeof setup>>

function deliveredCode(email: string) {
  const sent = [...mail.send.mock.calls].reverse().find(([message]) => message.to === email)?.[0]
  const code = /\b\d{6}\b/.exec(sent?.text ?? '')?.[0]
  if (!code) throw new Error(`No verification code delivered to ${email}`)
  return code
}

async function sendCurrentCode(fixture: Fixture) {
  await fixture.auth.api.sendVerificationOTP({
    headers: fixture.login.headers,
    body: { email: fixture.email, type: 'email-verification' },
  })
  return deliveredCode(fixture.email)
}

async function requestChange(fixture: Fixture, newEmail: string) {
  const otp = await sendCurrentCode(fixture)
  await fixture.auth.api.requestEmailChangeEmailOTP({
    headers: fixture.login.headers,
    body: { newEmail, otp },
  })
  return deliveredCode(newEmail.toLowerCase())
}

async function storedUser(fixture: Fixture, id = 'owner') {
  return fixture.context.internalAdapter.findUserById(id)
}

function cookieHeaders(headers: Headers) {
  const cookies = new Headers()
  applySetCookies(cookies, headers.getSetCookie())
  return cookies
}

beforeEach(() => {
  vi.clearAllMocks()
  mail.available.mockResolvedValue(true)
  mail.send.mockReset().mockResolvedValue({ success: true })
  policy.allowedDomains = ''
})

describe('account email change through native Better Auth OTP', () => {
  it('keeps registration and session hook reads on the auth transaction', async () => {
    const { adapter } = await productionAuth.$context
    const now = new Date()
    const tx = {
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () =>
              table === systemSettings
                ? [{ registrationMode: 'waitlist' }]
                : table === member
                  ? [{ organizationId: 'organization' }]
                  : table === waitlist
                    ? [{ status: 'approved' }]
                    : [],
          }),
        }),
      })),
    }
    vi.mocked(db.transaction).mockImplementationOnce(async (run) =>
      run(tx as unknown as Parameters<typeof run>[0])
    )

    await adapter.transaction(async () => {
      const { user, session } = productionAuth.options.databaseHooks
      await user.create.before({
        id: 'user',
        email: 'owner@example.com',
        name: 'Owner',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      await expect(
        session.create.before(
          {
            id: 'session',
            userId: 'user',
            token: 'token',
            expiresAt: now,
            createdAt: now,
            updatedAt: now,
          },
          null
        )
      ).resolves.toMatchObject({ data: { activeOrganizationId: 'organization' } })
    })
    expect(tx.select).toHaveBeenCalledTimes(5)
    expect(db.select).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'sets the mailbox owner’s chosen password after signup (duplicate=%s)',
    async (duplicate) => {
      const fixture = await setup('owner@example.com', true, true)
      const email = 'signup@example.com'
      const password = 'signup-password-123'
      const signup = await fixture.auth.api.signUpEmail({
        body: { email, password, name: 'New user', username: 'new.user' },
      })
      expect(signup.token).toBeNull()
      await expect(
        fixture.auth.api.isUsernameAvailable({ body: { username: 'new.user' } })
      ).resolves.toEqual({ available: false })
      if (duplicate) {
        const retry = await fixture.auth.api.signUpEmail({
          body: {
            email,
            password: 'another-signup-password',
            name: 'New user',
            username: 'retried.signup',
          },
        })
        expect(retry.token).toBeNull()
      }

      await fixture.auth.api.requestPasswordResetEmailOTP({ body: { email } })
      const chosenPassword = 'password-confirmed-with-mailbox-123'
      await fixture.auth.api.resetPasswordEmailOTP({
        body: { email, otp: deliveredCode(email), password: chosenPassword },
      })
      expect(mail.audience).toHaveBeenCalledWith(expect.objectContaining({ id: signup.user.id }))
      await expect(
        fixture.auth.api.signInEmail({ body: { email, password: chosenPassword } })
      ).resolves.toMatchObject({
        user: { id: signup.user.id, emailVerified: true, username: 'new.user' },
        token: expect.any(String),
      })
      await expect(
        fixture.auth.api.signInEmail({ body: { email, password } })
      ).rejects.toMatchObject({
        body: { code: 'INVALID_EMAIL_OR_PASSWORD' },
      })
    }
  )

  it('signs in a verified user with the emailed OTP', async () => {
    const fixture = await setup()
    const email = fixture.email
    await fixture.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
    const login = await fixture.auth.api.signInEmailOTP({
      body: { email, otp: deliveredCode(email) },
      returnHeaders: true,
    })
    expect(login.response).toMatchObject({
      user: { id: 'owner', email },
      token: expect.any(String),
    })
    await expect(
      fixture.auth.api.getSession({ headers: cookieHeaders(login.headers) })
    ).resolves.toMatchObject({ user: { id: 'owner', email } })
  })

  it('rotates the current session and signs out other devices on a password change', async () => {
    const { auth, context, login } = await setup()
    const { headers } = login
    const password = 'initial-password-123'
    await auth.api.setPassword({ headers, body: { newPassword: password } })
    const otherDevice = await context.test.login({ userId: login.session.userId })
    const newPassword = 'changed-password-123'
    await expect(
      auth.api.changePassword({ headers, body: { currentPassword: 'incorrect', newPassword } })
    ).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } })
    expect(await auth.api.getSession({ headers: otherDevice.headers })).toBeTruthy()

    const changed = await auth.api.changePassword({
      headers,
      body: { currentPassword: password, newPassword, revokeOtherSessions: false },
      returnHeaders: true,
    })
    expect(await auth.api.getSession({ headers: otherDevice.headers })).toBeNull()
    expect(await auth.api.getSession({ headers })).toBeNull()
    await expect(
      auth.api.getSession({ headers: cookieHeaders(changed.headers) })
    ).resolves.toMatchObject({
      user: { id: login.session.userId },
    })
  })

  it('resets the account password with the emailed OTP', async () => {
    const fixture = await setup()
    const email = fixture.email
    const password = 'reset-password-by-otp-123'
    await fixture.auth.api.requestPasswordResetEmailOTP({ body: { email } })
    await expect(
      fixture.auth.api.resetPasswordEmailOTP({
        body: { email, otp: deliveredCode(email), password },
      })
    ).resolves.toEqual({ success: true })
    expect(await fixture.auth.api.getSession({ headers: fixture.login.headers })).toBeNull()
    await expect(
      fixture.auth.api.signInEmail({ body: { email, password } })
    ).resolves.toMatchObject({ user: { id: 'owner' }, token: expect.any(String) })
  })

  it.each(['sign-in', 'email-verification'] as const)(
    'revokes unproven credentials after standalone %s OTP verification',
    async (type) => {
      const fixture = await setup('owner@example.com', true, true)
      const email = 'passwordless@example.com'
      const password = 'unproven-password-that-must-be-revoked'
      const signup = await fixture.auth.api.signUpEmail({
        body: { email, password, name: 'New user', username: 'new.user' },
      })
      await fixture.auth.api.sendVerificationOTP({ body: { email, type } })
      const body = { email, otp: deliveredCode(email) }
      if (type === 'sign-in') await fixture.auth.api.signInEmailOTP({ body })
      else await fixture.auth.api.verifyEmailOTP({ body })
      expect(await fixture.context.internalAdapter.findAccounts(signup.user.id)).toEqual([])
      await expect(
        fixture.auth.api.signInEmail({ body: { email, password } })
      ).rejects.toMatchObject({
        body: { code: 'INVALID_EMAIL_OR_PASSWORD' },
      })
    }
  )

  it.each([true, false])(
    'enforces the login allowlist before verification creates a session for verification=%s',
    async (emailVerified) => {
      const fixture = await setup('owner@example.com', true, true)
      const email = 'blocked@example.com'
      const signup = await fixture.auth.api.signUpEmail({
        body: {
          email,
          password: 'signup-password-that-must-remain-valid',
          name: 'New user',
          username: 'new.user',
        },
      })
      await fixture.context.internalAdapter.updateUser(signup.user.id, { emailVerified })
      await fixture.auth.api.sendVerificationOTP({ body: { email, type: 'email-verification' } })
      policy.allowedDomains = 'allowed.example.com'
      await expect(
        fixture.auth.api.verifyEmailOTP({ body: { email, otp: deliveredCode(email) } })
      ).rejects.toThrow('Access restricted')
      expect(await fixture.context.internalAdapter.listSessions(signup.user.id)).toEqual([])
      expect(await storedUser(fixture, signup.user.id)).toMatchObject({ emailVerified })
      expect(mail.audience).not.toHaveBeenCalled()
    }
  )

  it.each([true, false])(
    'requires both mailboxes and keeps existing sessions when current verification is %s',
    async (emailVerified) => {
      const fixture = await setup('owner@example.com', emailVerified)
      const otherDevice = await fixture.context.test.login({ userId: 'owner' })
      const otp = await requestChange(fixture, 'New@Example.com')
      expect(await storedUser(fixture)).toMatchObject({ email: fixture.email })
      expect(fixture.customerUpdate).not.toHaveBeenCalled()
      await expect(
        fixture.auth.api.changeEmailEmailOTP({
          headers: fixture.login.headers,
          body: { newEmail: 'new@example.com', otp: '000000' },
        })
      ).rejects.toMatchObject({ body: { code: 'INVALID_OTP' } })
      expect(await fixture.auth.api.getSession({ headers: otherDevice.headers })).toBeTruthy()

      const headers = new Headers(fixture.login.headers)
      headers.set('Content-Type', 'application/json')
      const changed = await fixture.auth.handler(
        new Request('http://localhost:3000/api/auth/email-otp/change-email', {
          method: 'POST',
          headers,
          body: JSON.stringify({ newEmail: 'new@example.com', otp }),
        })
      )

      expect(await changed.json()).toEqual({ success: true })
      await expect(
        fixture.auth.api.getSession({ headers: otherDevice.headers })
      ).resolves.toMatchObject({
        user: { id: 'owner', email: 'new@example.com' },
        session: { id: otherDevice.session.id },
      })
      expect(await storedUser(fixture)).toMatchObject({
        id: 'owner',
        email: 'new@example.com',
        emailVerified: true,
        stripeCustomerId: 'cus-owner',
      })
      expect(fixture.customerUpdate).toHaveBeenCalledWith('cus-owner', { email: 'new@example.com' })
      expect(mail.audience).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com', emailVerified: true }),
        'owner@example.com'
      )
      await expect(
        fixture.auth.api.getSession({ headers: cookieHeaders(changed.headers) })
      ).resolves.toMatchObject({
        user: { id: 'owner', email: 'new@example.com' },
        session: { id: fixture.login.session.id },
      })
    }
  )

  it('reports missing mail delivery before initiating either email change verification step', async () => {
    const fixture = await setup()
    const otp = await sendCurrentCode(fixture)
    mail.available.mockResolvedValue(false)
    const error = { statusCode: 503, body: { code: 'EMAIL_DELIVERY_UNAVAILABLE' } }
    await expect(sendCurrentCode(fixture)).rejects.toMatchObject(error)
    const request = { headers: fixture.login.headers, body: { newEmail: 'new@example.com', otp } }
    await expect(fixture.auth.api.requestEmailChangeEmailOTP(request)).rejects.toMatchObject(error)
    expect(mail.send).toHaveBeenCalledTimes(1)

    mail.available.mockResolvedValue(true)
    await expect(fixture.auth.api.requestEmailChangeEmailOTP(request)).resolves.toEqual({
      success: true,
    })
  })

  it('reports rejected delivery to the signed-in client and completes a fresh verification', async () => {
    const fixture = await setup()
    const { email, auth, login } = fixture
    const client = createAuthClient({
      baseURL: 'http://localhost:3000',
      plugins: [emailOTPClient()],
      fetchOptions: {
        headers: login.headers,
        customFetchImpl: (url, init) => auth.handler(new Request(url, init)),
      },
    })
    const newEmail = 'new@example.com'
    const body = { email, type: 'email-verification' as const }
    const rejection = { success: false, message: 'Mail provider unavailable' }
    const failure = { data: null, error: { status: 503 } }

    mail.send.mockResolvedValueOnce(rejection)
    expect((await auth.api.sendVerificationOTP({ body, asResponse: true })).status).toBe(200)
    mail.send.mockResolvedValueOnce(rejection)
    await expect(client.emailOtp.sendVerificationOtp(body)).resolves.toMatchObject(failure)

    const otp = await sendCurrentCode(fixture)
    mail.send.mockRejectedValueOnce(new Error(rejection.message))
    await expect(client.emailOtp.requestEmailChange({ newEmail, otp })).resolves.toMatchObject(
      failure
    )
    const freshOtp = await requestChange(fixture, newEmail)
    await expect(client.emailOtp.changeEmail({ newEmail, otp: freshOtp })).resolves.toMatchObject({
      data: { success: true },
      error: null,
    })
    expect(await storedUser(fixture)).toMatchObject({ email: newEmail })
  })

  it('completes the account email change when Stripe sync fails', async () => {
    const fixture = await setup()
    fixture.customerUpdate.mockRejectedValue(new Error('Unavailable'))

    const newEmail = 'new@example.com'
    const otp = await requestChange(fixture, newEmail)
    await fixture.auth.api.changeEmailEmailOTP({
      headers: fixture.login.headers,
      body: { newEmail, otp },
    })

    expect(fixture.customerUpdate).toHaveBeenCalledWith('cus-owner', { email: 'new@example.com' })
    expect(await storedUser(fixture)).toMatchObject({ email: 'new@example.com' })
  })

  it('keeps core email links disabled and requires proof of the current mailbox', async () => {
    const fixture = await setup()
    await expect(
      fixture.auth.api.changeEmail({
        headers: fixture.login.headers,
        body: { newEmail: 'new@example.com' },
      })
    ).rejects.toMatchObject({ body: { code: 'CHANGE_EMAIL_DISABLED' } })
    await expect(
      fixture.auth.api.requestEmailChangeEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: 'new@example.com' },
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(mail.send).not.toHaveBeenCalled()
    expect(await storedUser(fixture)).toMatchObject({ email: fixture.email })
  })

  it('rejects an invalid target address before issuing a new mailbox code', async () => {
    const fixture = await setup()
    const otp = await sendCurrentCode(fixture)
    await expect(
      fixture.auth.api.requestEmailChangeEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: 'invalid-email', otp },
      })
    ).rejects.toMatchObject({ body: { code: 'INVALID_EMAIL' } })
    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(await storedUser(fixture)).toMatchObject({ email: fixture.email })
  })

  it('applies the Studio login allowlist to the new address', async () => {
    const fixture = await setup()
    policy.allowedDomains = 'example.com'
    const otp = await sendCurrentCode(fixture)
    await expect(
      fixture.auth.api.requestEmailChangeEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: 'new@other.example', otp },
      })
    ).rejects.toMatchObject({ statusCode: 403, body: { code: 'EMAIL_CHANGE_NOT_ALLOWED' } })
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['request-password-reset', {}],
    ['request-password-reset', { email: 'invalid' }],
    ['reset-password', { token: 'invalid' }],
    ['reset-password', { newPassword: 'new-password' }],
  ])('rejects malformed %s requests through the native HTTP endpoint', async (path, body) => {
    const { auth } = await setup()
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
    expect(response.status).toBe(400)
    expect(mail.send).not.toHaveBeenCalled()
  })

  it('resets the password using the link delivered to the account email', async () => {
    const { auth, context, email, login } = await setup()
    const otherDevice = await context.test.login({ userId: login.session.userId })
    const password = 'reset-password-by-email-link-123'
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } })
    const message = mail.send.mock.calls.find(([message]) => message.to === email)?.[0]
    const href = /href="([^"]+\/api\/auth\/reset-password\/[^"]+)"/.exec(message?.html ?? '')?.[1]
    expect(href).toBeDefined()
    expect(await auth.api.getSession({ headers: otherDevice.headers })).toBeTruthy()

    const response = await auth.handler(new Request(href!))
    expect(response.status).toBe(302)
    const callback = new URL(response.headers.get('location')!)
    expect(callback.pathname).toBe('/reset-password')
    await expect(
      auth.api.resetPassword({
        body: { token: callback.searchParams.get('token')!, newPassword: password },
      })
    ).resolves.toEqual({ status: true })
    expect(await auth.api.getSession({ headers: login.headers })).toBeNull()
    expect(await auth.api.getSession({ headers: otherDevice.headers })).toBeNull()
    await expect(auth.api.signInEmail({ body: { email, password } })).resolves.toMatchObject({
      user: { id: 'owner', email },
      token: expect.any(String),
    })
  })
})

describe('native username authentication', () => {
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
    const headers = cookieHeaders(responseHeaders)
    const context = await auth.$context
    const sessions = await context.internalAdapter.listSessions(signup.user.id)
    return { auth, context, user: signup.user, headers, sessions }
  }

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
