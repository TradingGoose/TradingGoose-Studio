/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  currentUserId: null as string | null,
  grantAccess: vi.fn(),
  rows: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@tradinggoose/db/schema', () => ({
  userRateLimits: {
    referenceId: 'referenceId',
    syncApiRequests: 'syncApiRequests',
    asyncApiRequests: 'asyncApiRequests',
    apiEndpointRequests: 'apiEndpointRequests',
    windowStart: 'windowStart',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (_field: unknown, value: string) => ({ value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: ({ value }: { value: string }) => ({
          limit: async () => {
            const row = state.rows.get(value)
            return row ? [row] : []
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            state.rows.set(values.referenceId as string, { ...values })
            return [values]
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: ({ value: referenceId }: { value: string }) => {
          const row = state.rows.get(referenceId)
          if (row) {
            if (values.apiEndpointRequests && typeof values.apiEndpointRequests === 'object') {
              row.apiEndpointRequests = Number(row.apiEndpointRequests) + 1
            }
            if ('isRateLimited' in values) row.isRateLimited = values.isRateLimited
            if ('rateLimitResetAt' in values) row.rateLimitResetAt = values.rateLimitResetAt
            state.rows.set(referenceId, row)
          }
          return {
            returning: async () => (row ? [row] : []),
          }
        },
      }),
    }),
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: async () => (state.currentUserId ? { user: { id: state.currentUserId } } : null),
}))
vi.mock('@/lib/billing/settings', () => ({ isBillingEnabledForRuntime: async () => false }))
vi.mock('@/lib/billing/catalog', () => ({ getModalEnterpriseContactCard: async () => null }))
vi.mock('@/lib/billing/subscription-tier-display', () => ({
  toSubscriptionTierDisplay: (tier: unknown) => tier,
}))
vi.mock('@/lib/billing/tiers', () => ({
  getSubscriptionBillingScope: (userId: string) => ({ scopeType: 'user', scopeId: userId }),
  getTierRateLimits: (tier: { apiEndpointRateLimitPerMinute: number }) => ({
    syncPerMinute: 0,
    asyncPerMinute: 0,
    apiEndpointPerMinute: tier.apiEndpointRateLimitPerMinute,
  }),
  getPrivateBillingTiersForUser: async () => [],
  grantPrivateBillingTierAccessByCode: state.grantAccess,
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))
vi.mock('next-intl/server', () => ({
  getTranslations:
    async ({ locale }: { locale: string }) =>
    (key: string) => {
      const messages = {
        en: 'Too many access-code attempts. Please try again later.',
        es: 'Demasiados intentos de código de acceso. Inténtelo de nuevo más tarde.',
        zh: '访问码尝试次数过多，请稍后再试。',
      }
      return key === 'tooManyAttempts' ? messages[locale as keyof typeof messages] : key
    },
}))

import { POST } from '@/app/api/billing/private-tier-access/route'

function request(body: string, locale = 'en') {
  return new NextRequest('http://localhost/api/billing/private-tier-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `NEXT_LOCALE=${locale}` },
    body,
  })
}

describe('private tier access-code persisted rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    state.currentUserId = null
    state.rows.clear()
    state.grantAccess.mockImplementation(async (_userId: string, code: string) => ({
      ok: code === 'right',
    }))
  })

  it('enforces one five-attempt, ten-minute persisted window per authenticated user', async () => {
    expect((await POST(request('{"accessCode":"wrong"}'))).status).toBe(401)
    expect(state.rows.size).toBe(0)

    state.currentUserId = 'user-1'
    const attempts = [
      ['{', 400],
      ['{"accessCode":" "}', 400],
      ['{"accessCode":"wrong-a"}', 404],
      ['{"accessCode":"right"}', 200],
      ['{"accessCode":"wrong-b"}', 404],
    ] as const
    for (const [body, status] of attempts) {
      expect((await POST(request(body))).status).toBe(status)
    }

    const scope = 'user-1:private-tier-access-code'
    expect(state.rows.get(scope)?.apiEndpointRequests).toBe(5)
    expect(state.rows.size).toBe(1)
    expect(state.grantAccess).toHaveBeenCalledTimes(3)

    const english = await POST(request('{', 'en'))
    expect(english.status).toBe(429)
    expect(english.headers.get('Retry-After')).toBe('600')
    expect(english.headers.get('Cache-Control')).toBe('no-store')
    await expect(english.json()).resolves.toEqual({
      error: 'Too many access-code attempts. Please try again later.',
    })
    await expect((await POST(request('{', 'es'))).json()).resolves.toEqual({
      error: 'Demasiados intentos de código de acceso. Inténtelo de nuevo más tarde.',
    })
    await expect((await POST(request('{', 'zh'))).json()).resolves.toEqual({
      error: '访问码尝试次数过多，请稍后再试。',
    })
    expect(state.grantAccess).toHaveBeenCalledTimes(3)

    state.currentUserId = 'user-2'
    expect((await POST(request('{"accessCode":"wrong"}'))).status).toBe(404)
    expect(state.rows.get('user-2:private-tier-access-code')?.apiEndpointRequests).toBe(1)

    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'))
    state.currentUserId = 'user-1'
    expect((await POST(request('{"accessCode":"after-reset"}'))).status).toBe(404)
    expect(state.rows.get(scope)?.apiEndpointRequests).toBe(1)
    expect(state.rows.get(scope)?.windowStart).toEqual(new Date('2026-01-01T00:10:00.000Z'))
    expect(state.grantAccess).toHaveBeenCalledTimes(5)
  })
})
