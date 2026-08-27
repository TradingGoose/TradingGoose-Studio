/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot Usage API - Context', () => {
  const mockCheckInternalApiKey = vi.fn()
  const mockProxyCopilotRequest = vi.fn()
  const mockIsBillingEnabledForRuntime = vi.fn()
  const mockGetPersonalEffectiveSubscription = vi.fn()
  const mockGetTierCopilotCostMultiplier = vi.fn()
  const mockAccrueUserUsageCost = vi.fn()
  const mockResolveWorkflowBillingContext = vi.fn()
  const mockHasProcessedMessage = vi.fn()
  const mockMarkMessageAsProcessed = vi.fn()
  const mockReserveCopilotUsage = vi.fn()
  const mockCommitCopilotUsageReservation = vi.fn()
  const mockReleaseCopilotUsageReservation = vi.fn()
  const mockIsHosted = vi.fn()

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
    workflowExecutionMultiplier: 1,
    workflowModelCostMultiplier: 1,
    functionExecutionMultiplier: 1,
    copilotCostMultiplier,
    pricingFeatures: [],
    isPublic: true,
    isDefault: false,
    displayOrder: 0,
  })

  beforeEach(() => {
    vi.resetModules()
    mockProxyCopilotRequest.mockReset()
    mockCheckInternalApiKey.mockReset()
    mockIsBillingEnabledForRuntime.mockReset()
    mockGetPersonalEffectiveSubscription.mockReset()
    mockGetTierCopilotCostMultiplier.mockReset()
    mockAccrueUserUsageCost.mockReset()
    mockResolveWorkflowBillingContext.mockReset()
    mockHasProcessedMessage.mockReset()
    mockMarkMessageAsProcessed.mockReset()
    mockReserveCopilotUsage.mockReset()
    mockCommitCopilotUsageReservation.mockReset()
    mockReleaseCopilotUsageReservation.mockReset()
    mockIsHosted.mockReset()

    mockIsBillingEnabledForRuntime.mockResolvedValue(false)
    mockIsHosted.mockReturnValue(true)
    mockGetPersonalEffectiveSubscription.mockResolvedValue(null)
    mockGetTierCopilotCostMultiplier.mockImplementation(
      (tier: { copilotCostMultiplier?: number } | null | undefined) =>
        tier?.copilotCostMultiplier ?? 1
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
    mockReserveCopilotUsage.mockResolvedValue({
      allowed: true,
      status: 200,
      reservationId: 'reservation-1',
      reservedUsd: 1,
      currentUsage: 8,
      limit: 10,
      remaining: 1,
      activeReservedUsd: 1,
      scopeType: 'user',
      scopeId: 'user-1',
    })
    mockCommitCopilotUsageReservation.mockImplementation(async ({ operation }) => operation())
    mockReleaseCopilotUsageReservation.mockResolvedValue({
      released: true,
      reservationId: 'reservation-1',
      reservedUsd: 1,
      scopeType: 'user',
      scopeId: 'user-1',
    })

    mockCheckInternalApiKey.mockReturnValue({ success: false })

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
      checkInternalApiKey: (...args: any[]) => mockCheckInternalApiKey(...args),
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

    vi.doMock('@/lib/environment', () => ({
      isHosted: mockIsHosted(),
    }))

    vi.doMock('@/lib/billing/usage-accrual', () => ({
      accrueUserUsageCost: (...args: any[]) => mockAccrueUserUsageCost(...args),
    }))

    vi.doMock('@/lib/billing/workspace-billing', () => ({
      resolveWorkflowBillingContext: (...args: any[]) => mockResolveWorkflowBillingContext(...args),
    }))

    vi.doMock('@/lib/copilot/usage-reservations', () => ({
      reserveCopilotUsage: (...args: any[]) => mockReserveCopilotUsage(...args),
      commitCopilotUsageReservation: (...args: any[]) => mockCommitCopilotUsageReservation(...args),
      releaseCopilotUsageReservation: (...args: any[]) =>
        mockReleaseCopilotUsageReservation(...args),
    }))
  })

  it('accepts generic copilot context usage requests without workflowId', async () => {
    mockProxyCopilotRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          tokensUsed: 4321,
          percentage: 0.42,
          model: 'openai/gpt-5.6-terra',
          contextWindow: 128000,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'context',
        conversationId: 'conversation-1',
        model: 'openai/gpt-5.6-terra',
        workspaceId: 'workspace-1',
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      tokensUsed: 4321,
      percentage: 0.42,
      model: 'openai/gpt-5.6-terra',
      contextWindow: 128000,
    })

    expect(mockProxyCopilotRequest).toHaveBeenCalledWith({
      endpoint: '/api/get-context-usage',
      body: {
        conversationId: 'conversation-1',
        model: 'openai/gpt-5.6-terra',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    })
    expect(mockGetPersonalEffectiveSubscription).not.toHaveBeenCalled()
    expect(mockResolveWorkflowBillingContext).not.toHaveBeenCalled()
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'returns display-only context usage for hosted=%s browser sessions',
    async (hosted) => {
      mockIsHosted.mockReturnValue(hosted)
      mockIsBillingEnabledForRuntime.mockResolvedValue(true)
      mockProxyCopilotRequest.mockResolvedValue(
        new Response(
          JSON.stringify({
            tokensUsed: 100,
            percentage: 0.1,
            model: 'openai/gpt-5.6-terra',
            contextWindow: 128000,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )

      const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'context',
          conversationId: `conversation-${hosted ? 'hosted' : 'self-hosted'}`,
          model: 'openai/gpt-5.6-terra',
        }),
      })

      const { POST } = await import('@/app/api/copilot/usage/route')
      const response = await POST(request)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        tokensUsed: 100,
        percentage: 0.1,
        model: 'openai/gpt-5.6-terra',
        contextWindow: 128000,
      })
      expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
      expect(mockMarkMessageAsProcessed).not.toHaveBeenCalled()
    }
  )

  it('rejects context usage inspection without a browser session even with internal auth', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue(null),
    }))

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'context',
        conversationId: 'conversation-1',
        model: 'openai/gpt-5.6-terra',
        userId: 'user-1',
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(mockProxyCopilotRequest).not.toHaveBeenCalled()
  })

  it('rejects context usage commit requests because context usage is inspection-only', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: true })

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'context',
        conversationId: 'conversation-2',
        model: 'openai/gpt-5.6-terra',
        userId: 'user-1',
        assistantMessageId: 'assistant-message-1',
        reservationId: 'reservation-1',
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(mockProxyCopilotRequest).not.toHaveBeenCalled()
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockReleaseCopilotUsageReservation).not.toHaveBeenCalled()
  })

  it('reserves shared usage budget through the internal reserve action', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'reserve',
        userId: 'user-1',
        workflowId: 'workflow-1',
        requestedUsd: 1,
        reason: 'copilot_turn',
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      allowed: true,
      status: 200,
      reservationId: 'reservation-1',
      reservedUsd: 1,
      currentUsage: 8,
      limit: 10,
      remaining: 1,
      activeReservedUsd: 1,
      scopeType: 'user',
      scopeId: 'user-1',
    })
    expect(mockReserveCopilotUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: 'workflow-1',
      requestedUsd: 1,
      reason: 'copilot_turn',
    })
  })

  it('no-ops reserve requests when billing is disabled', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockIsBillingEnabledForRuntime.mockResolvedValue(false)

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'reserve',
        userId: 'user-1',
        requestedUsd: 1,
        reason: 'copilot_turn_model_call',
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      allowed: true,
      status: 200,
      reservationId: 'billing-disabled',
      reservedUsd: 0,
      currentUsage: 0,
      limit: Number.MAX_SAFE_INTEGER,
      remaining: Number.MAX_SAFE_INTEGER,
      activeReservedUsd: 0,
      scopeType: 'user',
      scopeId: 'user-1',
    })
    expect(mockReserveCopilotUsage).not.toHaveBeenCalled()
    expect(mockGetPersonalEffectiveSubscription).not.toHaveBeenCalled()
  })

  it('releases reservations through the internal release action', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'release',
        reservationId: 'reservation-1',
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      released: true,
      reservationId: 'reservation-1',
      reservedUsd: 1,
      scopeType: 'user',
      scopeId: 'user-1',
    })
    expect(mockReleaseCopilotUsageReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
    })
  })

  it('no-ops release requests for the billing-disabled sentinel', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockIsBillingEnabledForRuntime.mockResolvedValue(false)

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'release',
        reservationId: 'billing-disabled',
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      released: true,
      reservationId: 'billing-disabled',
    })
    expect(mockReleaseCopilotUsageReservation).not.toHaveBeenCalled()
  })

  it('releases real reservations even when billing is disabled', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockIsBillingEnabledForRuntime.mockResolvedValue(false)

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'release',
        reservationId: 'reservation-1',
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      released: true,
      reservationId: 'reservation-1',
      reservedUsd: 1,
      scopeType: 'user',
      scopeId: 'user-1',
    })
    expect(mockReleaseCopilotUsageReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
    })
  })
})

describe('Copilot Usage API - Completion', () => {
  const mockCheckInternalApiKey = vi.fn()
  const mockIsBillingEnabledForRuntime = vi.fn()
  const mockGetPersonalEffectiveSubscription = vi.fn()
  const mockGetTierCopilotCostMultiplier = vi.fn()
  const mockAccrueUserUsageCost = vi.fn()
  const mockResolveWorkflowBillingContext = vi.fn()
  const mockHasProcessedMessage = vi.fn()
  const mockMarkMessageAsProcessed = vi.fn()
  const mockCommitCopilotUsageReservation = vi.fn()
  const mockReleaseCopilotUsageReservation = vi.fn()
  const mockIsHosted = vi.fn()

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
    workflowExecutionMultiplier: 1,
    workflowModelCostMultiplier: 1,
    functionExecutionMultiplier: 1,
    copilotCostMultiplier,
    pricingFeatures: [],
    isPublic: true,
    isDefault: false,
    displayOrder: 0,
  })

  beforeEach(() => {
    vi.resetModules()
    mockCheckInternalApiKey.mockReset()
    mockIsBillingEnabledForRuntime.mockReset()
    mockGetPersonalEffectiveSubscription.mockReset()
    mockGetTierCopilotCostMultiplier.mockReset()
    mockAccrueUserUsageCost.mockReset()
    mockResolveWorkflowBillingContext.mockReset()
    mockHasProcessedMessage.mockReset()
    mockMarkMessageAsProcessed.mockReset()
    mockCommitCopilotUsageReservation.mockReset()
    mockReleaseCopilotUsageReservation.mockReset()
    mockIsHosted.mockReset()

    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)
    mockIsHosted.mockReturnValue(true)
    mockGetPersonalEffectiveSubscription.mockResolvedValue({
      id: 'subscription-personal',
      tier: createTier(2),
    })
    mockGetTierCopilotCostMultiplier.mockImplementation(
      (tier: { copilotCostMultiplier?: number } | null | undefined) =>
        tier?.copilotCostMultiplier ?? 1
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
    mockCommitCopilotUsageReservation.mockImplementation(async ({ reservationId, operation }) => {
      try {
        return await operation()
      } finally {
        if (reservationId) {
          await mockReleaseCopilotUsageReservation({ reservationId })
        }
      }
    })
    mockReleaseCopilotUsageReservation.mockResolvedValue({
      released: true,
      reservationId: 'reservation-1',
    })

    vi.doMock('drizzle-orm', () => ({
      sql: vi.fn(),
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-1' },
      }),
    }))

    vi.doMock('@/lib/copilot/utils', () => ({
      checkInternalApiKey: (...args: any[]) => mockCheckInternalApiKey(...args),
    }))

    vi.doMock('@/lib/environment', () => ({
      isHosted: mockIsHosted(),
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

    vi.doMock('@/lib/billing/usage-accrual', () => ({
      accrueUserUsageCost: (...args: any[]) => mockAccrueUserUsageCost(...args),
    }))

    vi.doMock('@/lib/billing/workspace-billing', () => ({
      resolveWorkflowBillingContext: (...args: any[]) => mockResolveWorkflowBillingContext(...args),
    }))

    vi.doMock('@/lib/copilot/usage-reservations', () => ({
      reserveCopilotUsage: vi.fn(),
      commitCopilotUsageReservation: (...args: any[]) => mockCommitCopilotUsageReservation(...args),
      releaseCopilotUsageReservation: (...args: any[]) =>
        mockReleaseCopilotUsageReservation(...args),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/redis', () => ({
      hasProcessedMessage: (...args: any[]) => mockHasProcessedMessage(...args),
      markMessageAsProcessed: (...args: any[]) => mockMarkMessageAsProcessed(...args),
    }))
  })

  it('settles from OpenRouter usage.cost instead of stale local catalog pricing', async () => {
    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'anthropic/claude-fable-5',
        completionId: 'completion-1',
        reservationId: 'reservation-1',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
          cost: 1.5,
          cost_details: { upstream_inference_cost: 999 },
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      billing: {
        billed: true,
        duplicate: false,
        tokens: 125,
        model: 'anthropic/claude-fable-5',
        cost: 3,
      },
    })
    expect(mockHasProcessedMessage).toHaveBeenCalledWith('copilot-completion-billing:completion-1')
    expect(mockAccrueUserUsageCost).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: undefined,
      cost: 3,
      extraUpdates: expect.any(Object),
      reason: 'copilot_completion_usage',
    })
    expect(mockMarkMessageAsProcessed).toHaveBeenCalledWith(
      'copilot-completion-billing:completion-1',
      60 * 60 * 24 * 30
    )
    expect(mockCommitCopilotUsageReservation).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: undefined,
      reservationId: 'reservation-1',
      operation: expect.any(Function),
    })
    expect(mockReleaseCopilotUsageReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
    })
  })

  it('returns non-2xx when completion settlement cannot find a ledger', async () => {
    mockAccrueUserUsageCost.mockResolvedValue(false)
    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'vendor/resolved-model',
        completionId: 'generic-completion-1',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
          cost: 1.5,
        },
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      billing: {
        billed: false,
        reason: 'ledger_not_found',
      },
    })
    expect(mockMarkMessageAsProcessed).not.toHaveBeenCalled()
  })

  it('mirrors hosted Copilot completion reports into self-hosted Studio usage', async () => {
    mockIsHosted.mockReturnValue(false)
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)
    mockGetPersonalEffectiveSubscription.mockResolvedValue({
      id: 'subscription-personal',
      tier: createTier(2),
    })

    const { mirrorLocalCopilotCompletionUsageReports } = await import(
      '@/lib/copilot/completion-usage-billing'
    )
    await mirrorLocalCopilotCompletionUsageReports({
      userId: 'user-1',
      reports: [
        {
          kind: 'completion',
          model: 'openai/gpt-5.6-terra',
          completionId: 'local-completion-1',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 25,
            total_tokens: 125,
            cost: 1.5,
          },
        },
      ],
    })

    expect(mockAccrueUserUsageCost).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: undefined,
      cost: 3,
      extraUpdates: expect.any(Object),
      reason: 'copilot_completion_usage',
    })
    expect(mockMarkMessageAsProcessed).toHaveBeenCalledWith(
      'copilot-completion-billing:local-completion-1',
      60 * 60 * 24 * 30
    )
    expect(mockCommitCopilotUsageReservation).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: undefined,
      operation: expect.any(Function),
    })
  })

  it('ignores invalid self-hosted Copilot completion mirror reports', async () => {
    mockIsHosted.mockReturnValue(false)
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)

    const { mirrorLocalCopilotCompletionUsageReports } = await import(
      '@/lib/copilot/completion-usage-billing'
    )
    await mirrorLocalCopilotCompletionUsageReports({
      userId: 'user-1',
      reports: [
        {
          kind: 'completion',
          model: 'openai/gpt-5.6-terra',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 25,
            total_tokens: 125,
          },
        },
      ],
    })

    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockHasProcessedMessage).not.toHaveBeenCalled()
    expect(mockCommitCopilotUsageReservation).not.toHaveBeenCalled()
  })

  it('isolates self-hosted reports that are missing authoritative provider cost', async () => {
    mockIsHosted.mockReturnValue(false)
    mockIsBillingEnabledForRuntime.mockResolvedValue(true)
    mockGetPersonalEffectiveSubscription.mockResolvedValue({
      id: 'subscription-personal',
      tier: createTier(2),
    })
    const { mirrorLocalCopilotCompletionUsageReports } = await import(
      '@/lib/copilot/completion-usage-billing'
    )
    await mirrorLocalCopilotCompletionUsageReports({
      userId: 'user-1',
      reports: [
        {
          kind: 'completion',
          model: 'openai/gpt-5.6-terra',
          completionId: 'local-completion-2',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 25,
            total_tokens: 125,
          },
        },
      ],
    })

    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockCommitCopilotUsageReservation).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: undefined,
      operation: expect.any(Function),
    })
    expect(mockMarkMessageAsProcessed).not.toHaveBeenCalled()
  })

  it('does not mirror hosted Copilot completion reports on hosted Studio', async () => {
    mockIsHosted.mockReturnValue(true)

    const { mirrorLocalCopilotCompletionUsageReports } = await import(
      '@/lib/copilot/completion-usage-billing'
    )
    await mirrorLocalCopilotCompletionUsageReports({
      userId: 'user-1',
      reports: [
        {
          kind: 'completion',
          model: 'openai/gpt-5.6-terra',
          completionId: 'hosted-completion-1',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.01 },
        },
      ],
    })

    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockCommitCopilotUsageReservation).not.toHaveBeenCalled()
  })

  it('does not double-bill duplicate completion ids', async () => {
    mockHasProcessedMessage.mockResolvedValue(true)

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'openai/gpt-5.6-terra',
        completionId: 'completion-1',
        reservationId: 'reservation-1',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
          cost: 1.5,
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      billing: {
        billed: false,
        duplicate: true,
      },
    })
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockMarkMessageAsProcessed).not.toHaveBeenCalled()
    expect(mockCommitCopilotUsageReservation).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: undefined,
      reservationId: 'reservation-1',
      operation: expect.any(Function),
    })
    expect(mockReleaseCopilotUsageReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
    })
  })

  it.each([
    ['missing', { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }],
    ['negative', { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: -0.01 }],
    ['malformed', { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: '0.01' }],
  ])('fails settlement for %s OpenRouter usage.cost', async (_case, usage) => {
    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'openai/gpt-5.6-terra',
        completionId: 'invalid-cost-completion',
        reservationId: 'reservation-1',
        usage,
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(500)
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockMarkMessageAsProcessed).not.toHaveBeenCalled()
    expect(mockReleaseCopilotUsageReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
    })
  })

  it('settles an explicit zero provider cost without consulting local pricing', async () => {
    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'vendor/free-model',
        completionId: 'free-completion',
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0 },
      }),
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      billing: {
        billed: true,
        duplicate: false,
        cost: 0,
        tokens: 12,
        model: 'vendor/free-model',
      },
    })
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockMarkMessageAsProcessed).toHaveBeenCalledWith(
      'copilot-completion-billing:free-completion',
      60 * 60 * 24 * 30
    )
  })

  it('rejects a completion commit without the required idempotency key', async () => {
    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'openai/gpt-5.6-terra',
        reservationId: 'reservation-1',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
          cost: 1.5,
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockReleaseCopilotUsageReservation).not.toHaveBeenCalled()
  })

  it('releases the reservation when completion billing is disabled', async () => {
    mockIsBillingEnabledForRuntime.mockResolvedValue(false)

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'openai/gpt-5.6-terra',
        completionId: 'completion-3',
        reservationId: 'reservation-1',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
          cost: 1.5,
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      billing: {
        billed: false,
        reason: 'billing_disabled',
      },
    })
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockReleaseCopilotUsageReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
    })
  })

  it('releases the reservation when completion billing throws', async () => {
    mockGetPersonalEffectiveSubscription.mockResolvedValue(null)

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'openai/gpt-5.6-terra',
        completionId: 'completion-2',
        reservationId: 'reservation-1',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
          cost: 1.5,
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(500)
    expect(mockAccrueUserUsageCost).not.toHaveBeenCalled()
    expect(mockMarkMessageAsProcessed).not.toHaveBeenCalled()
    expect(mockReleaseCopilotUsageReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1',
    })
  })

  it('rejects completion billing requests without internal auth', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: false, error: 'Invalid API key' })

    const request = new NextRequest('http://localhost:3000/api/copilot/usage', {
      method: 'POST',
      body: JSON.stringify({
        action: 'commit',
        kind: 'completion',
        userId: 'user-1',
        model: 'openai/gpt-5.6-terra',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 25,
          total_tokens: 125,
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/usage/route')
    const response = await POST(request)

    expect(response.status).toBe(401)
  })
})
