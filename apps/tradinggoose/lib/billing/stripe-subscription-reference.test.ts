/**
 * @vitest-environment node
 */
import { betterAuth } from 'better-auth'
import { testUtils } from 'better-auth/plugins'
import { afterEach, expect, it, vi } from 'vitest'

it('checks out the selected organization seats using the user Stripe customer', async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  const { auth: appAuth } = await import('@/lib/auth')
  customer.create.mockResolvedValue({ id: 'customer-1' })
  checkoutCreate.mockResolvedValue({
    id: 'checkout-1',
    url: 'https://checkout.stripe.test/session',
  })

  const auth = betterAuth({
    ...appAuth.options,
    database: undefined,
    secret: 'test-secret-that-is-long-enough-for-better-auth',
    plugins: [...appAuth.options.plugins, testUtils()],
  })
  const context = await auth.$context
  const testUser = context.test.createUser({ id: 'user-1' })
  await context.test.saveUser(testUser)
  const { headers } = await context.test.login({ userId: testUser.id })

  await expect(
    auth.api.upgradeSubscription({
      headers,
      body: {
        plan: 'team',
        referenceId: 'organization-1',
        seats: 7,
        successUrl: '/billing/success',
        cancelUrl: '/billing',
        disableRedirect: true,
      },
    })
  ).resolves.toMatchObject({
    url: 'https://checkout.stripe.test/session',
    redirect: false,
  })

  await expect(
    context.adapter.findOne({
      model: 'user',
      where: [{ field: 'id', value: testUser.id }],
    })
  ).resolves.toMatchObject({ stripeCustomerId: 'customer-1' })
  await expect(
    context.adapter.findOne({
      model: 'subscription',
      where: [{ field: 'referenceId', value: 'organization-1' }],
    })
  ).resolves.toMatchObject({
    referenceId: 'organization-1',
    stripeCustomerId: 'customer-1',
    seats: 7,
  })
  expect(customer.create).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ customerType: 'user', userId: testUser.id }),
    })
  )
  expect(checkoutCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      customer: 'customer-1',
      client_reference_id: 'organization-1',
      line_items: [{ price: 'price-team', quantity: 7 }],
      allow_promotion_codes: true,
    }),
    undefined
  )
})

const accountMail = vi.hoisted(() =>
  vi.fn(async (_message: { to: string; text: string; subject: string }) => ({ success: true }))
)
const customer = vi.hoisted(() => ({
  create: vi.fn(),
  search: vi.fn().mockResolvedValue({ data: [] }),
  retrieve: vi.fn(),
  update: vi.fn(),
}))
const checkoutCreate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/billing/authorization', () => ({
  authorizeSubscriptionReference: (_userId: string, { referenceId }: { referenceId: string }) =>
    referenceId === 'organization-1',
}))
vi.mock('@/lib/billing/plans', () => ({
  getBetterAuthPlansConfig: () => [{ name: 'team', priceId: 'price-team' }],
}))
vi.mock('@/lib/system-settings/service', () => ({
  getResolvedSystemSettings: () => ({ allowPromotionCodes: true }),
}))

vi.mock('@/lib/email/mailer', () => ({
  sendEmail: accountMail,
  addVerifiedUserEmailToAudience: vi.fn(),
}))
vi.mock('@/lib/email/locale', () => ({ resolveEmailLocale: vi.fn().mockResolvedValue('en') }))
vi.mock('@/lib/system-services/stripe-runtime', () => ({
  createStripeClientProxy: () => ({
    customers: customer,
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }) },
    checkout: { sessions: { create: checkoutCreate } },
  }),
  hasStripeSecretKey: () => false,
  getStripeServiceConfig: () => ({}),
}))
vi.mock('@/lib/registration/service', () => ({
  getRegistrationEligibility: () => ({ allowed: true }),
  markWaitlistEntrySignedUp: vi.fn(),
}))
vi.mock('@/lib/workspaces/service', () => ({ createDefaultWorkspaceForUser: vi.fn() }))
vi.mock('@/lib/billing/core/usage', () => ({ handleNewUser: vi.fn() }))
vi.mock('@/lib/billing/settings', () => ({
  getBillingGateState: () => ({ billingEnabled: false }),
}))
vi.mock('@/lib/env', async (original) => ({
  ...(await original<typeof import('@/lib/env')>()),
  env: process.env,
}))

afterEach(() => {
  vi.doUnmock('@/lib/auth')
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function accountVerificationFixture(verifySignup: boolean) {
  vi.resetModules()
  vi.stubEnv('EMAIL_VERIFICATION_ENABLED', String(verifySignup))
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  vi.stubEnv('BETTER_AUTH_SECRET', 'disposable-auth-handler-fixture-at-least-32-characters')
  vi.stubEnv('ALLOWED_LOGIN_EMAILS', 'OLD@EXAMPLE.COM')
  vi.stubEnv('ALLOWED_LOGIN_DOMAINS', 'TEAM.EXAMPLE')
  const { auth: appAuth } = await import('@/lib/auth')
  // The production adapter checks the plugin fields against our Drizzle schema at startup.
  await appAuth.$context
  const auth = betterAuth({
    ...appAuth.options,
    database: undefined,
    plugins: [...appAuth.options.plugins, testUtils()],
  })
  const { adapter } = await auth.$context
  const origin = 'http://localhost:3000'
  vi.doMock('@/lib/auth', () => ({ auth }))
  const { POST: sendLink } = await import('@/app/api/auth/request-email-change-link/route')
  const { ExecutionLimiter } = await import('@/services/queue/ExecutionLimiter')
  const limit = vi.spyOn(ExecutionLimiter.prototype, 'checkRateLimitWithSubscription')
  limit.mockResolvedValue({ allowed: true, remaining: 2, resetAt: new Date() })

  function post(path: string, body: Record<string, string>, cookie = '', requestOrigin = origin) {
    const request = new Request(`${origin}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: requestOrigin, cookie },
      body: JSON.stringify(body),
    })
    return path === '/request-email-change-link' ? sendLink(request) : auth.handler(request)
  }
  return { auth, adapter, origin, post, limit }
}

function lastCode(to: string, subject: string) {
  const message = accountMail.mock.lastCall?.[0]
  expect(message).toMatchObject({ to, subject: expect.stringContaining(subject) })
  const otp = message!.text.split('\n').at(-1)!
  expect(otp).toMatch(/^\d{6}$/)
  return otp
}

function currentMailboxCode(to: string, accountId: string, locale = 'en') {
  const message = accountMail.mock.lastCall?.[0]
  expect(message).toMatchObject({ to, logTextWhenUnconfigured: false })
  const url = new URL(message!.text.split('\n').at(-1)!)
  expect(url.origin + url.pathname + url.search).toBe(`http://localhost:3000/${locale}/reset-email`)
  const proof = new URLSearchParams(url.hash.slice(1))
  expect(proof.get('accountId')).toBe(accountId)
  const otp = proof.get('otp')!
  expect(otp).toMatch(/^\d{6}$/)
  return otp
}

it('limits email reset links to the authenticated account and its stored address', async () => {
  const { adapter, post, limit } = await accountVerificationFixture(false)
  const email = 'old@example.com'
  const created = await post('/sign-up/email', {
    email,
    name: 'Owner',
    username: 'owner_name',
    password: 'owner-password',
  })
  const { user } = await created.json()
  const cookie = cookies(created)
  const path = '/request-email-change-link'
  const body = { accountId: user.id }
  expect((await post(path, body)).status).toBe(401)
  expect((await post(path, { accountId: 'other-account' }, cookie)).status).toBe(403)
  expect((await post(path, body, cookie, 'https://other.example')).status).toBe(403)
  expect((await post(path, body, cookie, '')).status).toBe(403)
  expect((await post(path, { ...body, email: 'other@example.com' }, cookie)).status).toBe(400)
  expect((await post(path, { ...body, redirectTo: 'https://other.example' }, cookie)).status).toBe(
    400
  )
  expect(limit).not.toHaveBeenCalled()

  limit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: new Date() })
  expect((await post(path, body, cookie)).status).toBe(429)
  expect(limit).toHaveBeenCalledWith(
    user.id,
    expect.objectContaining({
      tier: expect.objectContaining({ apiEndpointRateLimitPerMinute: 3 }),
    }),
    'api-endpoint',
    false,
    {
      scopeType: 'user',
      scopeId: `${user.id}:email-change-link`,
      organizationId: null,
      userId: user.id,
    },
    { enforceWithoutBilling: true, failClosedOnError: true }
  )
  expect(await adapter.findMany({ model: 'verification' })).toHaveLength(0)
  expect(accountMail).not.toHaveBeenCalled()

  const storedEmail = 'updated@team.example'
  await adapter.update({
    model: 'user',
    where: [{ field: 'id', value: user.id }],
    update: { email: storedEmail },
  })
  expect((await post(path, body, cookie)).status).toBe(204)
  currentMailboxCode(storedEmail, user.id)
  expect(accountMail).toHaveBeenCalledTimes(1)
  expect(customer.update).not.toHaveBeenCalled()
})

it('uses native expiry, attempt limits and single-use mailbox proofs across repeated links', async () => {
  const { adapter, post } = await accountVerificationFixture(false)
  const email = 'old@example.com'
  const newEmail = 'target@team.example'
  const password = 'original-password'
  const owner = await post('/sign-up/email', {
    name: 'Owner',
    username: 'owner_name',
    email,
    password,
  })
  const { user } = await owner.json()
  const cookie = cookies(owner)
  const other = await post('/sign-up/email', {
    name: 'Other',
    username: 'other_name',
    email: 'other@team.example',
    password,
  })
  async function freshLink() {
    expect((await post('/request-email-change-link', { accountId: user.id }, cookie)).status).toBe(
      204
    )
    return currentMailboxCode(email, user.id)
  }
  const requestChange = (otp: string, session = cookie) =>
    post('/email-otp/request-email-change', { newEmail, otp }, session)
  const confirm = (otp: string, session = cookie) =>
    post('/email-otp/change-email', { newEmail, otp }, session)
  async function expirePendingProof() {
    const pending = await adapter.findMany<{ id: string }>({ model: 'verification' })
    expect(pending).toHaveLength(1)
    await adapter.update({
      model: 'verification',
      where: [{ field: 'id', value: pending[0].id }],
      update: { expiresAt: new Date(Date.now() - 1000) },
    })
  }

  let proof = await freshLink()
  await expirePendingProof()
  expect((await requestChange(proof)).ok).toBe(false)
  proof = await freshLink()
  const wrong = proof === '000000' ? '000001' : '000000'
  for (let i = 0; i < 3; i++) expect((await requestChange(wrong)).status).toBe(400)
  expect((await requestChange(proof)).status).toBe(403)
  const olderProof = await freshLink()
  proof = await freshLink()
  expect((await requestChange(proof, cookies(other))).ok).toBe(false)
  expect(accountMail.mock.calls.every(([message]) => message.to === email)).toBe(true)
  expect((await requestChange(proof)).status).toBe(200)
  const targetCode = lastCode(newEmail, 'Verify your new email')
  expect((await requestChange(olderProof)).ok).toBe(false)
  expect((await confirm(targetCode, cookies(other))).ok).toBe(false)
  await expirePendingProof()
  expect((await confirm(targetCode)).ok).toBe(false)
  expect((await requestChange(proof)).ok).toBe(false)
  expect(
    await adapter.findOne({ model: 'user', where: [{ field: 'id', value: user.id }] })
  ).toMatchObject({ email })
  expect(customer.update).not.toHaveBeenCalled()
  expect((await requestChange(await freshLink())).status).toBe(200)
  expect((await confirm(lastCode(newEmail, 'Verify your new email'))).status).toBe(200)
})

it.each([true, false])(
  'retries signup for an existing email with verification %s',
  async (verifySignup) => {
    const { adapter, post } = await accountVerificationFixture(verifySignup)
    const signup = {
      name: 'Original Name',
      username: 'original_name',
      email: 'old@example.com',
      password: 'original-password-52',
    }
    const retry = {
      ...signup,
      name: 'Retry Name',
      username: 'retry_name',
      password: 'retry-password-83',
    }
    const created = await post('/sign-up/email', signup)
    expect(created.status).toBe(200)
    const { user } = await created.json()
    expect(accountMail).toHaveBeenCalledTimes(verifySignup ? 1 : 0)
    const byUser = [{ field: 'userId', value: user.id }]
    const credential = await adapter.findOne({ model: 'account', where: byUser })
    expect(credential).toMatchObject({ providerId: 'credential', password: expect.any(String) })

    accountMail.mockClear()
    const retried = await post('/sign-up/email', retry)
    expect(retried.status).toBe(verifySignup ? 200 : 422)
    expect(cookies(retried)).toBe('')
    expect(accountMail).toHaveBeenCalledTimes(verifySignup ? 1 : 0)
    if (verifySignup) {
      expect(await retried.json()).toMatchObject({ token: null })
      const otp = lastCode(signup.email, 'Verify your email')
      const verified = await post('/email-otp/verify-email', { email: signup.email, otp })
      expect(verified.status).toBe(200)
      accountMail.mockClear()
      expect((await post('/sign-up/email', retry)).status).toBe(200)
      expect(accountMail).not.toHaveBeenCalled()
    }

    const login = await post('/sign-in/email', { email: signup.email, password: signup.password })
    expect(login.status).toBe(200)
    expect((await login.json()).user).toMatchObject({
      id: user.id,
      name: signup.name,
      username: signup.username,
      emailVerified: verifySignup,
    })
    expect(await adapter.findOne({ model: 'account', where: byUser })).toEqual(credential)
  }
)

it.each([true, false])(
  'recovers an identical signup through password login and syncs confirmed email with verification %s',
  async (verifySignup) => {
    const { auth, adapter, origin, post } = await accountVerificationFixture(verifySignup)
    const original = 'old@example.com'
    const newEmail = 'new@team.example'
    const password = 'test-password-5729'

    const signupDetails = {
      name: 'Preserved Name',
      email: original,
      username: 'User_Name',
      password,
    }
    const signup = await post('/sign-up/email', signupDetails)
    expect(signup.status).toBe(200)
    const { user } = await signup.json()
    expect(user).toMatchObject({
      name: 'Preserved Name',
      username: 'user_name',
      emailVerified: false,
    })
    const byId = [{ field: 'id', value: user.id }]
    const byUser = [{ field: 'userId', value: user.id }]
    const credential = await adapter.findOne({ model: 'account', where: byUser })
    expect(credential).toMatchObject({ providerId: 'credential', password: expect.any(String) })
    expect((await post('/sign-in/username', { username: 'user_name', password })).status).toBe(404)
    expect(accountMail).toHaveBeenCalledTimes(verifySignup ? 1 : 0)
    let cookie = cookies(signup)

    if (verifySignup) {
      lastCode(original, 'Verify your email')
      expect(cookie).toBe('')
      await post('/email-otp/send-verification-otp', { email: original, type: 'sign-in' })
      const signInOtp = lastCode(original, 'Sign in')
      expect((await post('/sign-in/email-otp', { email: original, otp: signInOtp })).status).toBe(
        404
      )
      expect(await adapter.findOne({ model: 'account', where: byUser })).toEqual(credential)
    }

    accountMail.mockClear()
    for (const email of [newEmail, original]) {
      const collision = await post('/sign-up/email', { ...signupDetails, email })
      expect(collision.status).toBe(400)
      expect(await collision.json()).toMatchObject({ code: 'USERNAME_IS_ALREADY_TAKEN' })
      expect(cookies(collision)).toBe('')
      const denied = await post('/sign-in/email', { email, password: 'incorrect-password' })
      expect(denied.status).toBe(401)
      expect(await denied.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' })
      expect(cookies(denied)).toBe('')
    }
    expect(accountMail).not.toHaveBeenCalled()
    const login = await post('/sign-in/email', { email: original, password })
    if (verifySignup) {
      expect(login.status).toBe(403)
      expect(await login.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
      expect(cookies(login)).toBe('')
      expect(accountMail).toHaveBeenCalledTimes(1)
      const otp = lastCode(original, 'Verify your email')
      vi.stubEnv('ALLOWED_LOGIN_EMAILS', '')
      expect((await post('/email-otp/verify-email', { email: original, otp })).status).toBe(403)
      expect(await adapter.findMany({ model: 'session', where: byUser })).toHaveLength(0)
      vi.stubEnv('ALLOWED_LOGIN_EMAILS', original)
      const { headers } = await (await auth.$context).test.login({ userId: user.id })
      const unverifiedCookie = headers.get('cookie')!
      const link = await post(
        '/request-email-change-link',
        { accountId: user.id },
        unverifiedCookie
      )
      expect(link.status).toBe(412)
      for (const path of ['/email-otp/request-email-change', '/email-otp/change-email']) {
        const denied = await post(path, { newEmail, otp: '000000' }, unverifiedCookie)
        expect(denied.status).toBe(403)
        expect(await denied.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
      }
      expect(accountMail).toHaveBeenCalledTimes(1)
      const resent = await post('/email-otp/send-verification-otp', {
        email: original,
        type: 'email-verification',
      })
      expect(resent.status).toBe(200)
      expect(accountMail).toHaveBeenCalledTimes(2)
      const verified = await post('/email-otp/verify-email', {
        email: original,
        otp: lastCode(original, 'Verify your email'),
      })
      expect(verified.status).toBe(200)
      cookie = cookies(verified)
    } else {
      expect(login.status).toBe(200)
      expect(cookies(login)).toBeTruthy()
      expect(accountMail).not.toHaveBeenCalled()
    }
    expect(cookie).toBeTruthy()
    expect(
      await (
        await auth.handler(new Request(origin + '/api/auth/get-session', { headers: { cookie } }))
      ).json()
    ).toMatchObject({ user: { id: user.id, email: original } })

    customer.retrieve.mockResolvedValue({ id: 'cus_personal', email: original })
    await adapter.update({
      model: 'user',
      where: byId,
      update: { stripeCustomerId: 'cus_personal' },
    })
    accountMail.mockClear()
    expect(
      (
        await post(
          '/email-otp/request-email-change',
          { newEmail: 'other@sub.team.example' },
          cookie
        )
      ).status
    ).toBe(403)
    expect(accountMail).not.toHaveBeenCalled()
    const { resolveEmailLocale } = await import('@/lib/email/locale')
    const getLocale = async ({ userId }: { userId?: string | null }) =>
      userId === user.id ? ('es' as const) : ('en' as const)
    vi.mocked(resolveEmailLocale)
      .mockImplementationOnce(getLocale)
      .mockImplementationOnce(getLocale)
    expect((await post('/email-otp/request-email-change', { newEmail }, cookie)).status).toBe(400)
    const sent = await post('/request-email-change-link', { accountId: user.id }, cookie)
    expect(sent.status).toBe(204)
    expect(await sent.text()).toBe('')
    const currentProof = currentMailboxCode(original, user.id, 'es')
    const sessions = await adapter.findMany({ model: 'session', where: byUser })
    const pendingProofs = await adapter.findMany({ model: 'verification' })
    const resend = await post('/email-otp/send-verification-otp', {
      email: original,
      type: 'email-verification',
    })
    expect(resend.status).toBe(200)
    expect(await resend.json()).toEqual({ success: true })
    if (!verifySignup) {
      const coreResend = await post('/send-verification-email', { email: original })
      expect(coreResend.status).toBe(200)
      expect(await coreResend.json()).toEqual({ status: true })
    }
    expect(accountMail).toHaveBeenCalledTimes(1)
    const denied = await post('/email-otp/verify-email', { email: original, otp: currentProof })
    expect(denied.status).toBe(400)
    expect(await denied.json()).toMatchObject({ code: 'INVALID_OTP' })
    expect(cookies(denied)).toBe('')
    expect(await adapter.findMany({ model: 'verification' })).toEqual(pendingProofs)
    expect(await adapter.findMany({ model: 'session', where: byUser })).toEqual(sessions)
    expect(await adapter.findOne({ model: 'user', where: byId })).toMatchObject({
      id: user.id,
      email: original,
      emailVerified: verifySignup,
    })
    expect(await adapter.findOne({ model: 'account', where: byUser })).toEqual(credential)
    expect(customer.update).not.toHaveBeenCalled()
    const requestChange = () =>
      post('/email-otp/request-email-change', { newEmail, otp: currentProof }, cookie)
    expect((await requestChange()).status).toBe(200)
    expect((await requestChange()).status).toBe(400)
    expect(accountMail).toHaveBeenCalledTimes(2)
    const otp = lastCode(newEmail, 'Verifica tu nuevo correo')
    expect(accountMail.mock.lastCall?.[0]).toMatchObject({ logTextWhenUnconfigured: false })
    expect(customer.update).not.toHaveBeenCalled()

    vi.stubEnv('ALLOWED_LOGIN_DOMAINS', '')
    expect((await post('/email-otp/change-email', { newEmail, otp }, cookie)).status).toBe(403)
    vi.stubEnv('ALLOWED_LOGIN_DOMAINS', 'TEAM.EXAMPLE')
    const incorrect = otp === '000000' ? '000001' : '000000'
    expect((await post('/email-otp/change-email', { newEmail, otp: incorrect }, cookie)).ok).toBe(
      false
    )
    expect(await adapter.findOne({ model: 'user', where: byId })).toMatchObject({ email: original })
    expect(customer.update).not.toHaveBeenCalled()

    expect((await post('/email-otp/change-email', { newEmail, otp }, cookie)).status).toBe(200)
    expect(await adapter.findOne({ model: 'user', where: byId })).toMatchObject({
      id: user.id,
      email: newEmail,
      emailVerified: true,
      name: user.name,
    })
    expect(customer.update).toHaveBeenCalledTimes(1)
    expect(customer.update).toHaveBeenCalledWith('cus_personal', { email: newEmail })
    expect((await post('/sign-out', {}, cookie)).status).toBe(200)
    const signIn = await post('/sign-in/email', { email: newEmail, password })
    expect(signIn.status).toBe(200)
    expect((await signIn.json()).user.id).toBe(user.id)
    expect(await adapter.findOne({ model: 'account', where: byUser })).toEqual(credential)
  },
  30_000
)
