import { stripe } from '@better-auth/stripe'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { emailOTP, testUtils } from 'better-auth/plugins'
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

vi.mock('@tradinggoose/db', () => ({ db: {} }))
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

async function setup(email = 'owner@example.com', emailVerified = true) {
  const productionOptions: BetterAuthOptions = productionAuth.options
  const productionOtp = productionAuth.options.plugins.find((plugin) => plugin.id === 'email-otp')
  if (!productionOtp) throw new Error('The email OTP plugin is required')
  let sequence = 100000
  const customerUpdate = vi.fn().mockResolvedValue({ id: 'cus-owner' })
  const auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'email-change-test-secret-that-is-long-enough',
    user: productionOptions.user,
    emailAndPassword: productionAuth.options.emailAndPassword,
    session: productionAuth.options.session,
    hooks: productionAuth.options.hooks,
    emailVerification: productionAuth.options.emailVerification,
    plugins: [
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

async function storedUser(fixture: Fixture, id = 'owner') {
  return fixture.context.internalAdapter.findUserById(id)
}

describe('account email change through native Better Auth OTP', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mail.available.mockReset().mockResolvedValue(true)
    mail.send.mockReset().mockResolvedValue({ success: true })
    policy.allowedDomains = ''
    policy.verificationEnabled = false
  })

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
    const otp = await requestChange(fixture, 'new@example.com')
    await fixture.auth.api.changeEmailEmailOTP({
      headers: fixture.login.headers,
      body: { newEmail: 'new@example.com', otp },
    })
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
    const otp = await requestChange(fixture, 'changed@example.com')
    await fixture.auth.api.changeEmailEmailOTP({
      headers: fixture.login.headers,
      body: { newEmail: 'changed@example.com', otp },
    })
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
    const otp = await requestChange(fixture, 'new@example.com')
    await fixture.auth.api.changeEmailEmailOTP({
      headers: fixture.login.headers,
      body: { newEmail: 'new@example.com', otp },
    })
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
    const otp = await requestChange(fixture, 'changed@example.com')
    await fixture.auth.api.changeEmailEmailOTP({
      headers: fixture.login.headers,
      body: { newEmail: 'changed@example.com', otp },
    })
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
      const otp = await requestChange(fixture, 'changed@example.com')
      await fixture.auth.api.changeEmailEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: 'changed@example.com', otp },
      })
      const second = await fixture.auth.api.signUpEmail({
        body: { email: fixture.email, password: 'second-owner-password', name: 'Second owner' },
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
      const otp = await requestChange(fixture, 'changed@example.com')
      await fixture.auth.api.changeEmailEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: 'changed@example.com', otp },
      })
      const second = await fixture.auth.api.signUpEmail({
        body: { email: fixture.email, password: 'second-owner-password', name: 'Second owner' },
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
    'keeps an in-flight %s redemption on its captured owner after consumption',
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
      const otp = await requestChange(fixture, 'changed@example.com')
      await fixture.auth.api.changeEmailEmailOTP({
        headers: fixture.login.headers,
        body: { newEmail: 'changed@example.com', otp },
      })
      const second = await fixture.auth.api.signUpEmail({
        body: { email: fixture.email, password: 'second-owner-password', name: 'Second owner' },
      })
      const user = await storedUser(fixture, second.user.id)
      const accounts = await fixture.context.internalAdapter.findAccounts(second.user.id)
      const sessions = await fixture.context.internalAdapter.listSessions(second.user.id)
      resume()
      const [outcome] = await Promise.allSettled([operation])
      delayedConsume.mockRestore()
      if (outcome.status === 'fulfilled' && 'user' in outcome.value) {
        expect(outcome.value.user.id).toBe('owner')
      }
      expect(await storedUser(fixture, second.user.id)).toEqual(user)
      expect(await fixture.context.internalAdapter.findAccounts(second.user.id)).toEqual(accounts)
      expect(await fixture.context.internalAdapter.listSessions(second.user.id)).toEqual(sessions)
      expect(await storedUser(fixture)).toMatchObject({ email: 'changed@example.com' })
    }
  )

  it('keeps ownerless signup proof separate from independently registered accounts', async () => {
    policy.verificationEnabled = true
    const fixture = await setup()
    const email = 'unclaimed@example.com'
    await fixture.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
    const otp = deliveredCode(email)
    const second = await fixture.auth.api.signUpEmail({
      body: { email, password: 'second-owner-password', name: 'Second owner' },
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
