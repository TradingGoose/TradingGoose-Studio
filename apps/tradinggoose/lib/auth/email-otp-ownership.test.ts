import { betterAuth } from 'better-auth'
import { emailOTP, testUtils } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'

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

describe('native email OTP ownership across issuance paths', () => {
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
