/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot Context Usage API', () => {
  const mockProxyCopilotRequest = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    mockProxyCopilotRequest.mockReset()

    vi.doMock('@tradinggoose/db', () => ({
      db: {},
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      userStats: {},
    }))

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(),
      sql: vi.fn(),
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-1' },
      }),
    }))

    vi.doMock('@/lib/copilot/utils', () => ({
      checkInternalApiKey: vi.fn(() => ({ success: false })),
    }))

    vi.doMock('@/app/api/copilot/proxy', () => ({
      proxyCopilotRequest: (...args: any[]) => mockProxyCopilotRequest(...args),
      getCopilotApiUrl: vi.fn(() => 'https://copilot.example.test/api/get-context-usage'),
    }))

    vi.doMock('@/lib/billing/threshold-billing', () => ({
      checkAndBillOverageThreshold: vi.fn(),
    }))

    vi.doMock('@/lib/billing/settings', () => ({
      isBillingEnabledForRuntime: vi.fn(() => Promise.resolve(false)),
    }))

    vi.doMock('@/lib/billing/core/subscription', () => ({
      getPersonalEffectiveSubscription: vi.fn().mockResolvedValue(null),
    }))

    vi.doMock('@/lib/billing/tiers', () => ({
      requireDefaultBillingTier: vi.fn().mockResolvedValue({
        id: 'tier_default',
        displayName: 'Community',
        ownerType: 'user',
        usageScope: 'individual',
        seatMode: 'fixed',
        monthlyPriceUsd: null,
        yearlyPriceUsd: null,
        includedUsageLimitUsd: null,
        storageLimitGb: null,
        concurrencyLimit: null,
        seatCount: null,
        seatMaximum: null,
        stripeMonthlyPriceId: null,
        stripeYearlyPriceId: null,
        stripeProductId: null,
        syncRateLimitPerMinute: null,
        asyncRateLimitPerMinute: null,
        apiEndpointRateLimitPerMinute: null,
        canEditUsageLimit: false,
        canConfigureSso: false,
        logRetentionDays: null,
        workflowModelCostMultiplier: 1,
        functionExecutionDurationMultiplier: 0,
        copilotCostMultiplier: 1,
        pricingFeatures: [],
        isPublic: true,
        isDefault: true,
        displayOrder: 0,
      }),
      getTierCopilotCostMultiplier: vi.fn(() => 1),
    }))

    vi.doMock('@/lib/env', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/env')>()

      return {
        ...actual,
        env: {
          ...actual.env,
          COPILOT_PROVIDER: 'anthropic',
          COPILOT_API_KEY: 'test-copilot-key',
        },
        getEnv: vi.fn((key: string) => {
          if (key === 'COPILOT_PROVIDER') return 'anthropic'
          if (key === 'COPILOT_API_KEY') return 'test-copilot-key'
          return actual.getEnv(key)
        }),
      }
    })

    vi.doMock('@/lib/copilot/runtime-provider.server', () => ({
      buildCopilotRuntimeProviderConfig: vi.fn(() => ({
        providerConfig: {
          provider: 'openai',
          model: 'gpt-5.4',
          apiKey: 'test-copilot-key',
        },
      })),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/redis', () => ({
      hasProcessedMessage: vi.fn(),
      markMessageAsProcessed: vi.fn(),
    }))

    vi.doMock('@/providers/ai/utils', () => ({
      calculateCost: vi.fn(),
    }))
  })

  it('accepts generic copilot context-usage requests without workflowId', async () => {
    mockProxyCopilotRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          tokensUsed: 4321,
          percentage: 0.42,
          model: 'gpt-5.4',
          contextWindow: 128000,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const request = new NextRequest('http://localhost:3000/api/copilot/context-usage', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'conversation-1',
        model: 'gpt-5.4',
      }),
    })

    const { POST } = await import('@/app/api/copilot/context-usage/route')
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      tokensUsed: 4321,
      percentage: 0.42,
      model: 'gpt-5.4',
      contextWindow: 128000,
    })

    expect(mockProxyCopilotRequest).toHaveBeenCalledWith({
      endpoint: '/api/get-context-usage',
      body: {
        conversationId: 'conversation-1',
        model: 'gpt-5.4',
        provider: {
          provider: 'openai',
          model: 'gpt-5.4',
          apiKey: 'test-copilot-key',
        },
        userId: 'user-1',
      },
    })
  })
})
