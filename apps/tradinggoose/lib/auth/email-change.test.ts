import { stripe } from '@better-auth/stripe'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { emailOTP, testUtils, username } from 'better-auth/plugins'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mail, policy } = vi.hoisted(() => ({
  mail: {
    available: vi.fn(),
    send: vi.fn(),
    audience: vi.fn(),
  },
  policy: { allowedDomains: '', verificationEnabled: false },
}))

vi.mock('@tradinggoose/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('@/lib/environment', async (original) => ({
  ...(await original<typeof import('@/lib/environment')>()),
  get isEmailVerificationEnabled() {
    return policy.verificationEnabled
  },
}))
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
  hasEmailService: mail.available,
  sendEmail: mail.send,
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
    user: productionOptions.user,
    emailAndPassword: {
      ...productionAuth.options.emailAndPassword,
      requireEmailVerification,
    },
    session: productionAuth.options.session,
    hooks: productionAuth.options.hooks,
    emailVerification: productionAuth.options.emailVerification,
    plugins: [
      username(),
      emailOTP({ ...productionOtp.options, generateOTP: () => String(++sequence) }),
      stripe({
        stripeClient: {
          customers: {
            retrieve: async () => ({ id: 'cus-owner', email }),
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

async function sendCurrentCode(
  fixture: Fixture,
  email = fixture.email,
  headers = fixture.login.headers
) {
  await fixture.auth.api.sendVerificationOTP({
    headers,
    body: { email, type: 'email-verification' },
  })
  return deliveredCode(email)
}

async function requestChange(fixture: Fixture, newEmail: string) {
  const otp = await sendCurrentCode(fixture)
  await fixture.auth.api.requestEmailChangeEmailOTP({
    headers: fixture.login.headers,
    body: { newEmail, otp },
  })
  return deliveredCode(newEmail.trim().toLowerCase())
}

async function completeEmailChange(fixture: Fixture, newEmail: string) {
  const otp = await requestChange(fixture, newEmail)
  await fixture.auth.api.changeEmailEmailOTP({
    headers: fixture.login.headers,
    body: { newEmail, otp },
  })
}

async function storedUser(fixture: Fixture, id = 'owner') {
  return fixture.context.internalAdapter.findUserById(id)
}

beforeEach(() => {
  vi.clearAllMocks()
  mail.available.mockReset().mockResolvedValue(true)
  mail.send.mockReset().mockResolvedValue({ success: true })
  policy.allowedDomains = ''
  policy.verificationEnabled = false
})

describe('account email change through native Better Auth OTP', () => {
  it('preserves the signup password through email verification and subsequent password login', async () => {
    policy.verificationEnabled = true
    const fixture = await setup('owner@example.com', true, true)
    const email = 'signup@example.com'
    const password = 'signup-password-that-must-remain-valid'
    const signup = await fixture.auth.api.signUpEmail({
      body: { email, password, name: 'New user', username: 'new.user' },
    })
    expect(signup.token).toBeNull()
    const accounts = await fixture.context.internalAdapter.findAccounts(signup.user.id)
    expect(accounts).toEqual([
      expect.objectContaining({ providerId: 'credential', password: expect.any(String) }),
    ])
    await fixture.auth.api.sendVerificationOTP({ body: { email, type: 'email-verification' } })
    const verified = await fixture.auth.api.verifyEmailOTP({
      body: { email, otp: deliveredCode(email) },
      asResponse: true,
    })
    expect(verified.status).toBe(200)
    const headers = new Headers({
      cookie: verified.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    })
    await expect(fixture.auth.api.getSession({ headers })).resolves.toMatchObject({
      user: { id: signup.user.id, email, emailVerified: true },
    })
    expect(await fixture.context.internalAdapter.findAccounts(signup.user.id)).toEqual(accounts)
    expect(mail.audience).toHaveBeenCalledWith(
      expect.objectContaining({ id: signup.user.id, emailVerified: true })
    )
    await fixture.auth.api.signOut({ headers })
    await expect(
      fixture.auth.api.signInEmail({ body: { email, password } })
    ).resolves.toMatchObject({
      user: { id: signup.user.id, emailVerified: true },
      token: expect.any(String),
    })
  })

  it('retains native credential revocation for passwordless sign-in to an unverified account', async () => {
    policy.verificationEnabled = true
    const fixture = await setup('owner@example.com', true, true)
    const email = 'passwordless@example.com'
    const password = 'unproven-password-that-must-be-revoked'
    const signup = await fixture.auth.api.signUpEmail({
      body: { email, password, name: 'New user', username: 'new.user' },
    })
    await fixture.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
    await fixture.auth.api.signInEmailOTP({ body: { email, otp: deliveredCode(email) } })
    expect(await fixture.context.internalAdapter.findAccounts(signup.user.id)).toEqual([])
    await expect(fixture.auth.api.signInEmail({ body: { email, password } })).rejects.toMatchObject(
      {
        body: { code: 'INVALID_EMAIL_OR_PASSWORD' },
      }
    )
  })

  it.each([true, false])(
    'enforces the login allowlist before verification creates a session for verification=%s',
    async (emailVerified) => {
      policy.verificationEnabled = true
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
    'requires both mailboxes and preserves identity when current verification is %s',
    async (emailVerified) => {
      const fixture = await setup('owner@example.com', emailVerified)
      const otherLogin = await fixture.context.test.login({ userId: 'owner' })
      const otp = await requestChange(fixture, ' New@Example.com ')
      expect(await storedUser(fixture)).toMatchObject({ email: fixture.email })
      expect(fixture.customerUpdate).not.toHaveBeenCalled()

      await fixture.auth.api.changeEmailEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: 'new@example.com', otp },
      })

      expect(await storedUser(fixture)).toMatchObject({
        id: 'owner',
        email: 'new@example.com',
        emailVerified: true,
        stripeCustomerId: 'cus-owner',
      })
      expect(fixture.customerUpdate).toHaveBeenCalledWith('cus-owner', { email: 'new@example.com' })
      expect(await fixture.auth.api.getSession({ headers: fixture.login.headers })).toMatchObject({
        user: { id: 'owner', email: 'new@example.com' },
        session: { id: fixture.login.session.id },
      })
      expect(await fixture.auth.api.getSession({ headers: otherLogin.headers })).toBeNull()
    }
  )

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

  it('reports delivery failures for both mailbox checks and permits a fresh request', async () => {
    const fixture = await setup()
    const newEmail = 'new@example.com'
    const rejected = { statusCode: 503, body: { code: 'EMAIL_CHANGE_SEND_FAILED' } }
    mail.send.mockResolvedValueOnce({ success: false, message: 'Provider rejected delivery' })
    await expect(sendCurrentCode(fixture)).rejects.toMatchObject(rejected)

    const otp = await sendCurrentCode(fixture)
    mail.send.mockResolvedValueOnce({ success: false, message: 'Provider rejected delivery' })
    await expect(
      fixture.auth.api.requestEmailChangeEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail, otp },
      })
    ).rejects.toMatchObject(rejected)

    expect(await storedUser(fixture)).toMatchObject({ email: fixture.email })
    expect(await requestChange(fixture, newEmail)).toMatch(/^\d{6}$/)
  })

  it.each([
    { target: 'someone@mailinator.com', code: 'INVALID_EMAIL' },
    { target: 'occupied@example.com', code: 'EMAIL_CHANGE_EMAIL_IN_USE' },
    {
      target: 'new@blocked.example.com',
      code: 'EMAIL_CHANGE_NOT_ALLOWED',
      allowedDomains: 'example.com',
    },
  ])(
    'rejects $target before issuing a new mailbox code',
    async ({ target, code, allowedDomains }) => {
      const fixture = await setup()
      await fixture.context.test.saveUser(
        fixture.context.test.createUser({
          id: 'other',
          email: 'occupied@example.com',
        })
      )
      policy.allowedDomains = allowedDomains ?? ''
      const otp = await sendCurrentCode(fixture)
      await expect(
        fixture.auth.api.requestEmailChangeEmailOTP({
          headers: fixture.login.headers,
          body: { newEmail: target, otp },
        })
      ).rejects.toMatchObject({ body: { code } })
      expect(mail.send).toHaveBeenCalledTimes(1)
      expect(await storedUser(fixture)).toMatchObject({ email: fixture.email })
    }
  )

  it('fails closed before sending when no email provider is configured', async () => {
    const fixture = await setup()
    mail.available.mockResolvedValue(false)
    await expect(sendCurrentCode(fixture)).rejects.toMatchObject({
      body: { code: 'EMAIL_CHANGE_UNAVAILABLE' },
    })
    expect(mail.send).not.toHaveBeenCalled()
    expect(await storedUser(fixture)).toMatchObject({ email: fixture.email })
    expect(fixture.customerUpdate).not.toHaveBeenCalled()
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

  it('invalidates this user’s old password reset links without removing other verifications', async () => {
    const fixture = await setup()
    await fixture.context.test.saveUser(
      fixture.context.test.createUser({ id: 'other', email: 'other@example.com' })
    )
    await fixture.auth.api.requestPasswordReset({ body: { email: fixture.email } })
    await fixture.auth.api.requestPasswordReset({ body: { email: fixture.email } })
    await fixture.auth.api.requestPasswordReset({ body: { email: 'other@example.com' } })
    const tokens = await fixture.context.adapter.findMany<{ identifier: string; value: string }>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'reset-password:', operator: 'starts_with' }],
    })
    const ownerTokens = tokens.filter((token) => JSON.parse(token.value).userId === 'owner')
    expect(ownerTokens).toHaveLength(2)
    expect(JSON.parse(ownerTokens[0].value)).toEqual({ userId: 'owner', email: fixture.email })
    await fixture.context.internalAdapter.createVerificationValue({
      identifier: 'other-purpose:owner',
      value: 'owner',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await completeEmailChange(fixture, 'new@example.com')
    for (const token of ownerTokens) {
      await expect(
        fixture.auth.api.resetPassword({
          body: {
            token: token.identifier.slice('reset-password:'.length),
            newPassword: 'new-password',
          },
        })
      ).rejects.toMatchObject({ body: { code: 'INVALID_TOKEN' } })
    }
    const other = tokens.find((token) => JSON.parse(token.value).userId === 'other')!
    expect(
      await fixture.auth.api.resetPassword({
        body: {
          token: other.identifier.slice('reset-password:'.length),
          newPassword: 'new-password',
        },
      })
    ).toEqual({ status: true })
    expect(
      await fixture.context.internalAdapter.findVerificationValue('other-purpose:owner')
    ).toMatchObject({ value: 'owner' })
  })

  it('rejects an overlapping old-address reset request and accepts only bound reset records', async () => {
    const fixture = await setup()
    let resume!: () => void
    let paused!: () => void
    let token = ''
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    const reached = new Promise<void>((resolve) => {
      paused = resolve
    })
    const create = fixture.context.internalAdapter.createVerificationValue.bind(
      fixture.context.internalAdapter
    )
    const delayedCreate = vi
      .spyOn(fixture.context.internalAdapter, 'createVerificationValue')
      .mockImplementation(async (data) => {
        if (data.identifier.startsWith('reset-password:')) {
          token = data.identifier.slice('reset-password:'.length)
          paused()
          await gate
        }
        return create(data)
      })
    const resetRequest = fixture.auth.api.requestPasswordReset({ body: { email: fixture.email } })
    await reached
    await completeEmailChange(fixture, 'changed@example.com')
    resume()
    await resetRequest
    delayedCreate.mockRestore()
    expect(
      mail.send.mock.calls.some(
        ([message]) => message.to === fixture.email && message.html.includes(token)
      )
    ).toBe(true)
    const callback = await fixture.auth.handler(
      new Request(
        `http://localhost:3000/api/auth/reset-password/${token}?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Freset-password`
      )
    )
    expect.soft(callback.headers.get('location')).toContain('error=INVALID_TOKEN')
    expect.soft(callback.headers.get('location')).not.toContain('token=')
    await expect(
      fixture.auth.api.resetPassword({ body: { token, newPassword: 'new-password' } })
    ).rejects.toMatchObject({ statusCode: 400, body: { code: 'INVALID_TOKEN' } })
    await fixture.auth.api.requestPasswordReset({ body: { email: 'changed@example.com' } })
    const [fresh] = await fixture.context.adapter.findMany<{ identifier: string }>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'reset-password:', operator: 'starts_with' }],
    })
    expect(
      await fixture.auth.api.resetPassword({
        body: {
          token: fresh.identifier.slice('reset-password:'.length),
          newPassword: 'new-password',
        },
      })
    ).toEqual({ status: true })
    for (const [invalidToken, value] of [
      ['unbound', 'owner'],
      ['malformed', '{'],
      [
        'extra-fields',
        JSON.stringify({ userId: 'owner', email: 'changed@example.com', extra: true }),
      ],
    ]) {
      await create({
        identifier: `reset-password:${invalidToken}`,
        value,
        expiresAt: new Date(Date.now() + 60_000),
      })
      await expect(
        fixture.auth.api.resetPassword({
          body: { token: invalidToken, newPassword: 'another-password' },
        })
      ).rejects.toMatchObject({ statusCode: 400, body: { code: 'INVALID_TOKEN' } })
    }
  })

  it('revokes every other session beyond the first page, including expired sessions', async () => {
    const fixture = await setup()
    for (let index = 0; index < 101; index++) {
      await fixture.context.internalAdapter.createSession(
        'owner',
        false,
        { expiresAt: new Date(Date.now() - 1000) },
        true
      )
    }
    const other = await fixture.context.test.login({ userId: 'owner' })
    await completeEmailChange(fixture, 'new@example.com')
    expect(
      await fixture.context.adapter.count({
        model: 'session',
        where: [{ field: 'userId', value: 'owner' }],
      })
    ).toBe(1)
    expect(await fixture.auth.api.getSession({ headers: other.headers })).toBeNull()
    expect(await fixture.auth.api.getSession({ headers: fixture.login.headers })).toMatchObject({
      session: { id: fixture.login.session.id },
    })
  })

  it('rejects a pending code after the current email changes and accepts a fresh request', async () => {
    const fixture = await setup()
    const staleOtp = await requestChange(fixture, 'pending@example.com')
    await completeEmailChange(fixture, 'changed@example.com')
    await expect(
      fixture.auth.api.changeEmailEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: 'pending@example.com', otp: staleOtp },
      })
    ).rejects.toMatchObject({ body: { code: 'INVALID_OTP' } })
    expect(await storedUser(fixture)).toMatchObject({ email: 'changed@example.com' })
    const currentOtp = await sendCurrentCode(fixture, 'changed@example.com')
    await fixture.auth.api.requestEmailChangeEmailOTP({
      headers: fixture.login.headers,
      body: { newEmail: 'pending@example.com', otp: currentOtp },
    })
    await fixture.auth.api.changeEmailEmailOTP({
      headers: fixture.login.headers,
      body: { newEmail: 'pending@example.com', otp: deliveredCode('pending@example.com') },
    })
    expect(await storedUser(fixture)).toMatchObject({ email: 'pending@example.com' })
  })

  it.each(['sign-in', 'forget-password', 'email-verification'] as const)(
    'binds %s proof to its original owner when the address is reused',
    async (type) => {
      policy.verificationEnabled = true
      const fixture = await setup()
      await fixture.auth.api.sendVerificationOTP({ body: { email: fixture.email, type } })
      const oldOtp = deliveredCode(fixture.email)
      await completeEmailChange(fixture, 'changed@example.com')
      const second = await fixture.auth.api.signUpEmail({
        body: {
          email: fixture.email,
          password: 'second-owner-password',
          name: 'Second owner',
          username: 'second.owner',
        },
      })
      const accounts = await fixture.context.internalAdapter.findAccounts(second.user.id)
      const sessions = await fixture.context.internalAdapter.listSessions(second.user.id)
      const operation =
        type === 'sign-in'
          ? fixture.auth.api.signInEmailOTP({ body: { email: fixture.email, otp: oldOtp } })
          : type === 'forget-password'
            ? fixture.auth.api.resetPasswordEmailOTP({
                body: { email: fixture.email, otp: oldOtp, password: 'attacker-password' },
              })
            : fixture.auth.api.verifyEmailOTP({ body: { email: fixture.email, otp: oldOtp } })
      await expect(operation).rejects.toMatchObject({ body: { code: 'INVALID_OTP' } })
      expect(await fixture.context.internalAdapter.findAccounts(second.user.id)).toEqual(accounts)
      expect(await fixture.context.internalAdapter.listSessions(second.user.id)).toEqual(sessions)
      expect(await storedUser(fixture, second.user.id)).toMatchObject({ emailVerified: false })

      await fixture.auth.api.sendVerificationOTP({ body: { email: fixture.email, type } })
      const freshOtp = deliveredCode(fixture.email)
      if (type === 'sign-in') {
        expect(
          await fixture.auth.api.signInEmailOTP({ body: { email: fixture.email, otp: freshOtp } })
        ).toMatchObject({ user: { id: second.user.id } })
      } else if (type === 'forget-password') {
        expect(
          await fixture.auth.api.resetPasswordEmailOTP({
            body: { email: fixture.email, otp: freshOtp, password: 'new-owner-password' },
          })
        ).toEqual({ success: true })
      } else {
        expect(
          await fixture.auth.api.verifyEmailOTP({ body: { email: fixture.email, otp: freshOtp } })
        ).toMatchObject({ status: true, user: { id: second.user.id, emailVerified: true } })
      }
    }
  )

  it.each(['sign-in', 'forget-password'] as const)(
    'binds delayed %s issuance before an address changes owners',
    async (type) => {
      policy.verificationEnabled = true
      const fixture = await setup()
      let resume!: () => void
      let paused!: () => void
      const gate = new Promise<void>((resolve) => {
        resume = resolve
      })
      const reached = new Promise<void>((resolve) => {
        paused = resolve
      })
      const create = fixture.context.internalAdapter.createVerificationValue.bind(
        fixture.context.internalAdapter
      )
      const delayedCreate = vi
        .spyOn(fixture.context.internalAdapter, 'createVerificationValue')
        .mockImplementation(async (data) => {
          if (data.identifier.startsWith(`${type}-otp-`)) {
            paused()
            await gate
          }
          return create(data)
        })
      const issuance =
        type === 'sign-in'
          ? fixture.auth.api.sendVerificationOTP({ body: { email: fixture.email, type } })
          : fixture.auth.api.requestPasswordResetEmailOTP({ body: { email: fixture.email } })
      await reached
      await completeEmailChange(fixture, 'changed@example.com')
      const second = await fixture.auth.api.signUpEmail({
        body: {
          email: fixture.email,
          password: 'second-owner-password',
          name: 'Second owner',
          username: 'second.owner',
        },
      })
      const accounts = await fixture.context.internalAdapter.findAccounts(second.user.id)
      const sessions = await fixture.context.internalAdapter.listSessions(second.user.id)
      resume()
      await issuance
      delayedCreate.mockRestore()
      const oldOtp = deliveredCode(fixture.email)
      const operation =
        type === 'sign-in'
          ? fixture.auth.api.signInEmailOTP({ body: { email: fixture.email, otp: oldOtp } })
          : fixture.auth.api.resetPasswordEmailOTP({
              body: { email: fixture.email, otp: oldOtp, password: 'attacker-password' },
            })
      await expect(operation).rejects.toMatchObject({ body: { code: 'INVALID_OTP' } })
      expect(await fixture.context.internalAdapter.findAccounts(second.user.id)).toEqual(accounts)
      expect(await fixture.context.internalAdapter.listSessions(second.user.id)).toEqual(sessions)
      expect(await storedUser(fixture, second.user.id)).toMatchObject({ emailVerified: false })
    }
  )

  it.each(['sign-in', 'forget-password', 'email-verification'] as const)(
    'rejects an in-flight %s redemption after its mailbox changes during consumption',
    async (type) => {
      policy.verificationEnabled = true
      const fixture = await setup()
      await fixture.auth.api.sendVerificationOTP({ body: { email: fixture.email, type } })
      const oldOtp = deliveredCode(fixture.email)
      let resume!: () => void
      let paused!: () => void
      let shouldPause = true
      const gate = new Promise<void>((resolve) => {
        resume = resolve
      })
      const reached = new Promise<void>((resolve) => {
        paused = resolve
      })
      const consume = fixture.context.internalAdapter.consumeVerificationValue.bind(
        fixture.context.internalAdapter
      )
      const delayedConsume = vi
        .spyOn(fixture.context.internalAdapter, 'consumeVerificationValue')
        .mockImplementation(async (identifier) => {
          const record = await consume(identifier)
          if (shouldPause && record && identifier.startsWith(`${type}-otp-`)) {
            shouldPause = false
            paused()
            await gate
          }
          return record
        })
      const operation =
        type === 'sign-in'
          ? fixture.auth.api.signInEmailOTP({ body: { email: fixture.email, otp: oldOtp } })
          : type === 'forget-password'
            ? fixture.auth.api.resetPasswordEmailOTP({
                body: { email: fixture.email, otp: oldOtp, password: 'new-password' },
              })
            : fixture.auth.api.verifyEmailOTP({ body: { email: fixture.email, otp: oldOtp } })
      await reached
      await completeEmailChange(fixture, 'changed@example.com')
      const second = await fixture.auth.api.signUpEmail({
        body: {
          email: fixture.email,
          password: 'second-owner-password',
          name: 'Second owner',
          username: 'second.owner',
        },
      })
      const user = await storedUser(fixture, second.user.id)
      const accounts = await fixture.context.internalAdapter.findAccounts(second.user.id)
      const sessions = await fixture.context.internalAdapter.listSessions(second.user.id)
      const owner = await storedUser(fixture)
      const ownerAccounts = await fixture.context.internalAdapter.findAccounts('owner')
      const ownerSessions = await fixture.context.internalAdapter.listSessions('owner')
      resume()
      const [outcome] = await Promise.allSettled([operation])
      delayedConsume.mockRestore()
      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: { body: { code: 'INVALID_OTP' } },
      })
      expect(await storedUser(fixture, second.user.id)).toEqual(user)
      expect(await fixture.context.internalAdapter.findAccounts(second.user.id)).toEqual(accounts)
      expect(await fixture.context.internalAdapter.listSessions(second.user.id)).toEqual(sessions)
      expect(await storedUser(fixture)).toEqual(owner)
      expect(await fixture.context.internalAdapter.findAccounts('owner')).toEqual(ownerAccounts)
      expect(await fixture.context.internalAdapter.listSessions('owner')).toEqual(ownerSessions)
    }
  )

  it('keeps ownerless signup proof separate from independently registered accounts', async () => {
    policy.verificationEnabled = true
    const fixture = await setup()
    const email = 'unclaimed@example.com'
    await fixture.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
    const otp = deliveredCode(email)
    const second = await fixture.auth.api.signUpEmail({
      body: {
        email,
        password: 'second-owner-password',
        name: 'Second owner',
        username: 'second.owner',
      },
    })
    const accounts = await fixture.context.internalAdapter.findAccounts(second.user.id)
    const sessions = await fixture.context.internalAdapter.listSessions(second.user.id)
    await expect(fixture.auth.api.signInEmailOTP({ body: { email, otp } })).rejects.toMatchObject({
      body: { code: 'INVALID_OTP' },
    })
    expect(await fixture.context.internalAdapter.findAccounts(second.user.id)).toEqual(accounts)
    expect(await fixture.context.internalAdapter.listSessions(second.user.id)).toEqual(sessions)
    expect(await storedUser(fixture, second.user.id)).toMatchObject({ emailVerified: false })

    const newEmail = 'new-signup@example.com'
    await fixture.auth.api.sendVerificationOTP({ body: { email: newEmail, type: 'sign-in' } })
    const signedUp = await fixture.auth.api.signInEmailOTP({
      body: { email: newEmail, otp: deliveredCode(newEmail), name: 'New owner' },
    })
    expect(signedUp.user).toMatchObject({ email: newEmail, emailVerified: true })
    expect(signedUp.user.id).not.toBe(second.user.id)
    expect(signedUp.token).toEqual(expect.any(String))
  })

  it('rejects a code from another account whose native email-pair key collides', async () => {
    const fixture = await setup('victim@company.com')
    const attackerEmail = 'victim@company.com-attacker.com'
    const attackerTarget = 'mail@attacker.com'
    const victimTarget = 'attacker.com-mail@attacker.com'
    await fixture.context.test.saveUser(
      fixture.context.test.createUser({
        id: 'attacker',
        email: attackerEmail,
        emailVerified: true,
      })
    )
    const attacker = await fixture.context.test.login({ userId: 'attacker' })
    const otp = await sendCurrentCode(fixture, attackerEmail, attacker.headers)
    await fixture.auth.api.requestEmailChangeEmailOTP({
      headers: attacker.headers,
      body: { newEmail: attackerTarget, otp },
    })
    const newOtp = deliveredCode(attackerTarget)
    await expect(
      fixture.auth.api.changeEmailEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: victimTarget, otp: newOtp },
      })
    ).rejects.toMatchObject({ body: { code: 'INVALID_OTP' } })
    expect(await storedUser(fixture)).toMatchObject({ email: fixture.email })
    await fixture.auth.api.changeEmailEmailOTP({
      headers: attacker.headers,
      body: { newEmail: attackerTarget, otp: newOtp },
    })
    expect(await storedUser(fixture, 'attacker')).toMatchObject({ email: attackerTarget })
  })
})

describe('native email OTP ownership across issuance paths', () => {
  const email = 'owner@example.com'
  const signInQuery = { email: email.toUpperCase(), type: 'sign-in' as const }
  const invalidOTP = { body: { code: 'INVALID_OTP' } }

  async function setup(storeOTP: 'plain' | 'hashed' | 'encrypted' = 'plain') {
    const delivered = new Map<string, string>()
    let sequence = 100000
    const auth = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'native-otp-ownership-test-secret-long-enough',
      emailAndPassword: { enabled: true },
      plugins: [
        emailOTP({
          storeOTP,
          resendStrategy: 'reuse',
          sendVerificationOnSignUp: true,
          allowedAttempts: 2,
          generateOTP: () => String(++sequence),
          sendVerificationOTP: async (data) => {
            delivered.set(`${data.type}:${data.email}`, data.otp)
          },
        }),
        testUtils(),
      ],
    })
    const context = await auth.$context
    await context.test.saveUser(context.test.createUser({ id: 'owner', email }))
    const reassignEmail = async () => {
      await context.internalAdapter.updateUser('owner', { email: 'moved@example.com' })
      await context.test.saveUser(context.test.createUser({ id: 'replacement', email }))
    }
    return { auth, delivered, reassignEmail }
  }

  it.each(['plain', 'hashed', 'encrypted'] as const)(
    'isolates create/get/check and redemption after reassignment with %s storage',
    async (storeOTP) => {
      const { auth, reassignEmail } = await setup(storeOTP)
      const otp = await auth.api.createVerificationOTP({ body: signInQuery })
      const getOTP = () => auth.api.getVerificationOTP({ query: signInQuery })
      if (storeOTP === 'hashed') {
        await expect(getOTP()).rejects.toMatchObject({ statusCode: 400 })
      } else {
        await expect(getOTP()).resolves.toEqual({ otp })
      }
      await expect(
        auth.api.checkVerificationOTP({ body: { ...signInQuery, otp: '999999' } })
      ).rejects.toMatchObject(invalidOTP)
      await expect(
        auth.api.checkVerificationOTP({ body: { ...signInQuery, otp } })
      ).resolves.toEqual({ success: true })

      await reassignEmail()
      await expect(getOTP()).resolves.toEqual({ otp: null })
      await expect(
        auth.api.checkVerificationOTP({ body: { ...signInQuery, otp } })
      ).rejects.toMatchObject(invalidOTP)
      await expect(auth.api.signInEmailOTP({ body: { email, otp } })).rejects.toMatchObject(
        invalidOTP
      )
      const replacementOTP = await auth.api.createVerificationOTP({ body: signInQuery })
      await expect(
        auth.api.signInEmailOTP({ body: { email, otp: replacementOTP } })
      ).resolves.toMatchObject({ user: { id: 'replacement' } })
      await expect(
        auth.api.signInEmailOTP({ body: { email, otp: replacementOTP } })
      ).rejects.toMatchObject(invalidOTP)
    }
  )

  it('binds signup-hook verification to the newly created user', async () => {
    const { auth, delivered } = await setup()
    const created = await auth.api.signUpEmail({
      body: { email: 'signup@example.com', name: 'Signup', password: 'signup-password-123' },
    })
    const otp = delivered.get('email-verification:signup@example.com')!
    expect(otp).toMatch(/^\d{6}$/)
    await expect(
      auth.api.verifyEmailOTP({ body: { email: 'SIGNUP@EXAMPLE.COM', otp } })
    ).resolves.toMatchObject({ user: { id: created.user.id, emailVerified: true } })
  })

  it('reuses codes and attempt budgets only for the same owner', async () => {
    const { auth, delivered, reassignEmail } = await setup('encrypted')
    const send = async () => {
      await auth.api.sendVerificationOTP({ body: signInQuery })
      return delivered.get(`sign-in:${email}`)!
    }
    const wrongAttempt = () => auth.api.signInEmailOTP({ body: { email, otp: '999999' } })
    const ownerOTP = await send()
    await expect(wrongAttempt()).rejects.toMatchObject(invalidOTP)
    expect(await send()).toBe(ownerOTP)

    await reassignEmail()
    const replacementOTP = await send()
    expect(replacementOTP).not.toBe(ownerOTP)
    await expect(wrongAttempt()).rejects.toMatchObject(invalidOTP)
    expect(await send()).toBe(replacementOTP)
    await expect(wrongAttempt()).rejects.toMatchObject(invalidOTP)
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: replacementOTP } })
    ).rejects.toMatchObject({ body: { code: 'TOO_MANY_ATTEMPTS' } })
    await expect(auth.api.getVerificationOTP({ query: signInQuery })).resolves.toEqual({
      otp: null,
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
