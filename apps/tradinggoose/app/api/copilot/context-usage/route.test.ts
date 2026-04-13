/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot Context Usage API', () => {
  const mockProxyCopilotRequest = vi.fn()
  const mockIsBillingEnabledForRuntime = vi.fn()
  const mockGetPersonalEffectiveSubscription = vi.fn()
  const mockGetTierCopilotCostMultiplier = vi.fn()
  const mockAccrueUserUsageCost = vi.fn()
  const mockResolveWorkflowBillingContext = vi.fn()
  const mockHasProcessedMessage = vi.fn()
  const mockMarkMessageAsProcessed = vi.fn()
  const mockCalculateCost = vi.fn()

  const createTier = (copilotCostMultiplier: number) => ({
    id: `tier-${copilotCostMultiplier}`,
    displayName: 'Community',
    ownerType: 'user' as const,
    usageScope: 'individual' as const,
    seatMode: 'fixed' as const,
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
    copilotCostMultiplier,
    pricingFeatures: [],
    isPublic: true,
    isDefault: false,
    displayOrder: 0,
  })

  beforeEach(() => {
    vi.resetModules()
    mockProxyCopilotRequest.mockReset()
    mockIsBillingEnabledForRuntime.mockReset()
    mockGetPersonalEffectiveSubscription.mockReset()
    mockGetTierCopilotCostMultiplier.mockReset()
    mockAccrueUserUsageCost.mockReset()
    mockResolveWorkflowBillingContext.mockReset()
    mockHasProcessedMessage.mockReset()
    mockMarkMessageAsProcessed.mockReset()
    mockCalculateCost.mockReset()

    mockIsBillingEnabledForRuntime.mockResolvedValue(false)
    mockGetPersonalEffectiveSubscription.mockResolvedValue(null)
    mockGetTierCopilotCostMultiplier.mockImplementation(
      (tier: { copilotCostMultiplier?: number } | null | undefined) => tier?.copilotCostMultiplier ?? 1
    )
    mockAccrueUserUsageCost.mockResolvedValue(true)
    mockResolveWorkflowBillingContext.mockResolvedValue({
      billingUserId: 'user-1',
      subscription: {
        id: 'subscription-workflow',
        tier: createTier(3),
      },
    })
    mockHasProcessedMessage.mockResolvedValue(false)
    mockMarkMessageAsProcessed.mockResolvedValue(undefined)
    mockCalculateCost.mockReturnValue({ total: 1.5 })

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
      isBillingEnabledForRuntime: (...args: any[]) => mockIsBillingEnabledForRuntime(...args),
    }))

    vi.doMock('@/lib/billing/core/subscription', () => ({
      getPersonalEffectiveSubscription: (...args: any[]) =>
        mockGetPersonalEffectiveSubscription(...args),
    }))

    vi.doMock('@/lib/billing/tiers', () => ({
      getTierCopilotCostMultiplier: (...args: any[]) => mockGetTierCopilotCostMultiplier(...args),
    }))

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
      hasProcessedMessage: (...args: any[]) => mockHasProcessedMessage(...args),
      markMessageAsProcessed: (...args: any[]) => mockMarkMessageAsProcessed(...args),
    }))

    vi.doMock('@/providers/ai/utils', () => ({
      calculateCost: (...args: any[]) => mockCalculateCost(...args),
    }))

    vi.doMock('@/lib/billing/usage-accrual', () => ({
      accrueUserUsageCost: (...args: any[]) => mockAccrueUserUsageCost(...args),
    }))

    vi.doMock('@/lib/billing/workspace-billing', () => ({
      resolveWorkflowBillingContext: (...args: any[]) => mockResolveWorkflowBillingContext(...args),
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
    expect(mockGetPersonalEffectiveSubscription).not.toHaveBeenCalled()
    expect(mockResolveWorkflowBillingContext).not.toHaveBeenCalled()
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
  })

  it('bills personal copilot usage with the active subscription tier only', async () => {
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)
    mockGetPersonalEffectiveSubscription.mockResolvedValue({
      id: 'subscription-personal',
      tier: createTier(2),
    })

    mockProxyCopilotRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          tokensUsed: 100,
          model: 'gpt-5.4',
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
        conversationId: 'conversation-2',
        model: 'gpt-5.4',
        bill: true,
        assistantMessageId: 'assistant-message-1',
      }),
    })

    const { POST } = await import('@/app/api/copilot/context-usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockGetPersonalEffectiveSubscription).toHaveBeenCalledWith('user-1')
    expect(mockResolveWorkflowBillingContext).not.toHaveBeenCalled()
    expect(mockAccrueUserUsageCost).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: undefined,
      cost: 3,
      extraUpdates: expect.any(Object),
      reason: 'copilot_context_usage',
    })
    expect(mockMarkMessageAsProcessed).toHaveBeenCalledWith(
      'copilot-billing:assistant-message-1',
      60 * 60 * 24 * 30
    )
  })

  it('bills workflow copilot usage with the workflow subscription tier only', async () => {
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)

    mockProxyCopilotRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          tokensUsed: 100,
          model: 'gpt-5.4',
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
        conversationId: 'conversation-3',
        model: 'gpt-5.4',
        workflowId: 'workflow-1',
        bill: true,
        assistantMessageId: 'assistant-message-2',
      }),
    })

    const { POST } = await import('@/app/api/copilot/context-usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockResolveWorkflowBillingContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      actorUserId: 'user-1',
    })
    expect(mockGetPersonalEffectiveSubscription).not.toHaveBeenCalled()
    expect(mockAccrueUserUsageCost).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: 'workflow-1',
      cost: 4.5,
      extraUpdates: expect.any(Object),
      reason: 'copilot_context_usage',
    })
  })

  it('does not silently bill billed copilot usage when no active subscription tier exists', async () => {
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)
    mockGetPersonalEffectiveSubscription.mockResolvedValue(null)

    mockProxyCopilotRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          tokensUsed: 100,
          model: 'gpt-5.4',
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
        conversationId: 'conversation-4',
        model: 'gpt-5.4',
        bill: true,
        assistantMessageId: 'assistant-message-3',
      }),
    })

    const { POST } = await import('@/app/api/copilot/context-usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockGetPersonalEffectiveSubscription).toHaveBeenCalledWith('user-1')
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockMarkMessageAsProcessed).not.toHaveBeenCalled()
  })
})
