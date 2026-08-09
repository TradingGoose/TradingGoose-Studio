/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getPrivateTiers: vi.fn(),
  getSession: vi.fn(),
  grantAccess: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/api/rate-limit', () => ({
  checkPrivateTierAccessCodeRateLimit: mocks.checkRateLimit,
}))
vi.mock('@/lib/billing/catalog', () => ({ getModalEnterpriseContactCard: vi.fn(() => null) }))
vi.mock('@/lib/billing/subscription-tier-display', () => ({
  toSubscriptionTierDisplay: (tier: unknown) => tier,
}))
vi.mock('@/lib/billing/tiers', () => ({
  getPrivateBillingTiersForUser: mocks.getPrivateTiers,
  grantPrivateBillingTierAccessByCode: mocks.grantAccess,
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async ({ locale }: { locale: string }) => (key: string) => {
    const messages = {
      en: 'Too many access-code attempts. Please try again later.',
      es: 'Demasiados intentos de código de acceso. Inténtelo de nuevo más tarde.',
      zh: '访问码尝试次数过多，请稍后再试。',
    }
    return key === 'tooManyAttempts' ? messages[locale as keyof typeof messages] : key
  }),
}))

import { POST } from './route'

function request(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/billing/private-tier-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

describe('private tier access POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: new Date(Date.now() + 600_000),
    })
    mocks.getPrivateTiers.mockResolvedValue([])
    mocks.grantAccess.mockResolvedValue({ ok: false })
  })

  it('does not charge unauthenticated requests', async () => {
    mocks.getSession.mockResolvedValue(null)
    const response = await POST(request('{"accessCode":"code"}'))

    expect(response.status).toBe(401)
    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
  })

  it.each([
    ['blank', '{"accessCode":"   "}', 400],
    ['malformed', '{', 400],
    ['invalid', '{"accessCode":"wrong"}', 404],
    ['valid', '{"accessCode":"right"}', 200],
  ])('charges an authenticated %s attempt before validation', async (name, body, status) => {
    if (name === 'valid') mocks.grantAccess.mockResolvedValue({ ok: true })
    const response = await POST(request(body))

    expect(response.status).toBe(status)
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('user-1')
  })

  it.each([
    ['en', 'Too many access-code attempts. Please try again later.'],
    ['es', 'Demasiados intentos de código de acceso. Inténtelo de nuevo más tarde.'],
    ['zh', '访问码尝试次数过多，请稍后再试。'],
  ])('returns a localized generic 429 for %s', async (locale, message) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-01-01T00:02:01.000Z'),
    })

    const response = await POST(
      request('{"accessCode":"right"}', { cookie: `NEXT_LOCALE=${locale}` })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('121')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: message })
    expect(mocks.grantAccess).not.toHaveBeenCalled()
  })

  it('fails closed before parsing or granting when limiter storage is unavailable', async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 600_000),
      failureKind: 'dependency',
    })
    const response = await POST(request('{'))

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBeTruthy()
    expect(mocks.grantAccess).not.toHaveBeenCalled()
  })
})
