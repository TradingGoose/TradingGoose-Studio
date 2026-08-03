// @vitest-environment node
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  globalMockData,
  mockExecutionDependencies,
} from '@/app/api/__test-utils__/utils'

const hasProcessedMessageMock = vi.fn().mockResolvedValue(false)
const markMessageAsProcessedMock = vi.fn().mockResolvedValue(true)
const closeRedisConnectionMock = vi.fn().mockResolvedValue(undefined)
const acquireLockMock = vi.fn().mockResolvedValue(true)
const handleWhatsAppVerificationMock = vi.fn().mockResolvedValue(null)
const handleSlackChallengeMock = vi.fn().mockReturnValue(null)
const enqueuePendingExecutionMock = vi.fn().mockResolvedValue({
  pendingExecutionId: 'pending-webhook-1',
  billingScopeId: 'billing-scope-1',
})

const createWebhookProcessorMock = (findWebhookAndWorkflow: ReturnType<typeof vi.fn>) => ({
  checkUsageLimits: vi.fn(),
  findWebhookAndWorkflow,
  handleProviderChallenges: vi.fn(),
  mapDispatchGateResultToHttpResponse: vi.fn(),
  parseWebhookBody: vi.fn(),
  queueWebhookExecution: vi.fn(),
  verifyProviderAuth: vi.fn(),
})

vi.mock('@/lib/redis', () => ({
  hasProcessedMessage: hasProcessedMessageMock,
  markMessageAsProcessed: markMessageAsProcessedMock,
  closeRedisConnection: closeRedisConnectionMock,
  acquireLock: acquireLockMock,
  getRedisClient: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/webhooks/utils', () => ({
  handleWhatsAppVerification: handleWhatsAppVerificationMock,
  handleSlackChallenge: handleSlackChallengeMock,
  verifyProviderWebhook: vi.fn().mockReturnValue(null),
}))

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}))

vi.mock('postgres', () => vi.fn().mockReturnValue({}))

describe('Webhook Trigger API Route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doUnmock('@/lib/webhooks/processor')

    globalMockData.webhooks.length = 0
    globalMockData.workflows.length = 0
    globalMockData.schedules.length = 0

    mockExecutionDependencies()
    vi.doMock('@/lib/trigger/settings', () => ({
      TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {
        constructor(
          message: string,
          public statusCode = 503
        ) {
          super(message)
          this.name = 'TriggerExecutionUnavailableError'
        }
      },
    }))

    globalMockData.workflows.push({
      id: 'test-workflow-id',
      userId: 'test-user-id',
      pinnedApiKeyId: 'test-pinned-api-key-id',
    })

    vi.doMock('@/lib/api-key/service', () => ({
      getApiKeyOwnerUserId: vi
        .fn()
        .mockImplementation(async (pinnedApiKeyId: string | null | undefined) =>
          pinnedApiKeyId ? 'test-user-id' : null
        ),
    }))

    vi.doMock('@/lib/billing/settings', () => ({
      isBillingEnabledForRuntime: vi.fn().mockResolvedValue(false),
    }))

    vi.doMock('@/lib/execution/pending-execution', () => ({
      enqueuePendingExecution: (...args: any[]) => enqueuePendingExecutionMock(...args),
      isPendingExecutionLimitError: vi.fn(() => false),
    }))

    vi.doMock('@/lib/billing/workspace-billing', () => ({
      resolveWorkspaceBillingContext: vi.fn(),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadWorkflowFromNormalizedTables: vi.fn().mockResolvedValue({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      }),
      blockExistsInDeployment: vi.fn().mockResolvedValue(true),
    }))

    hasProcessedMessageMock.mockResolvedValue(false)
    markMessageAsProcessedMock.mockResolvedValue(true)
    acquireLockMock.mockResolvedValue(true)
    handleWhatsAppVerificationMock.mockResolvedValue(null)
    enqueuePendingExecutionMock.mockReset()
    enqueuePendingExecutionMock.mockResolvedValue({
      pendingExecutionId: 'pending-webhook-1',
      billingScopeId: 'billing-scope-1',
    })

    if ((global as any).crypto?.randomUUID) {
      vi.spyOn(crypto, 'randomUUID').mockRestore()
    }

    vi.spyOn(crypto, 'randomUUID').mockReturnValue('mock-uuid-12345')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const found = (provider: string, triggerId?: string) => ({
    webhook: { id: `${provider}-webhook`, provider, providerConfig: { triggerId } },
    workflow: { id: 'workflow-1' },
  })
  const callbackPath = 'microsoftteams-00000000-0000-4000-8000-000000000000'

  it.each([
    ['uncommitted Graph callback', 'POST', callbackPath, null, 200, false],
    [
      'committed Graph callback',
      'POST',
      'teams-path',
      found('microsoftteams', 'microsoftteams_chat_subscription'),
      200,
      false,
    ],
    ['generic webhook collision', 'POST', 'generic-path', found('generic'), 418, true],
    [
      'Teams outgoing webhook collision',
      'POST',
      'teams-outgoing-path',
      found('microsoftteams', 'microsoftteams_webhook'),
      418,
      true,
    ],
    ['monitor collision', 'POST', 'monitor-path', found('indicator'), 403, false],
    ['unknown path collision', 'POST', 'unknown-path', null, 404, false],
    ['GET callback collision', 'GET', callbackPath, null, 404, false],
  ] as const)(
    '%s follows its provider-specific route',
    { timeout: 10_000 },
    async (_name, method, path, findResult, status, parses) => {
      const findWebhookAndWorkflowMock = vi.fn().mockResolvedValue(findResult)
      const processor = createWebhookProcessorMock(findWebhookAndWorkflowMock)
      processor.parseWebhookBody.mockResolvedValue(new NextResponse('Parsed', { status: 418 }))
      vi.doMock('@/lib/webhooks/processor', () => processor)

      const req = createMockRequest(method)
      Object.defineProperty(req, 'url', {
        value: `http://localhost:3000/api/webhooks/trigger/${path}?validationToken=token%2Bvalue`,
      })
      const route = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await route[method](req, { params: Promise.resolve({ path }) })

      expect(response.status).toBe(status)
      expect(findWebhookAndWorkflowMock).toHaveBeenCalledOnce()
      expect(processor.parseWebhookBody).toHaveBeenCalledTimes(parses ? 1 : 0)
      if (status === 200) {
        expect(response.headers.get('content-type')).toBe('text/plain')
        await expect(response.text()).resolves.toBe('token+value')
      }
    }
  )

  describe('Microsoft Teams chat notification authentication', () => {
    const webhookId = 'teams-chat-webhook-id'

    beforeEach(() => {
      vi.doMock('@/lib/billing', () => ({
        checkServerSideUsageLimits: vi.fn().mockResolvedValue({ isExceeded: false }),
      }))

      globalMockData.webhooks.push({
        id: webhookId,
        provider: 'microsoftteams',
        path: 'teams-chat-path',
        isActive: true,
        providerConfig: { triggerId: 'microsoftteams_chat_subscription' },
        workflowId: 'test-workflow-id',
        blockId: 'teams-chat-trigger-id',
      })
    })

    it('queues a notification batch owned by the stored subscription', async () => {
      const body = {
        value: [
          { clientState: webhookId, subscriptionId: 'subscription-1', id: 'notification-1' },
          { clientState: webhookId, subscriptionId: 'subscription-1', id: 'notification-2' },
        ],
      }
      const request = createMockRequest('POST', body)
      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')

      const response = await POST(request, {
        params: Promise.resolve({ path: 'teams-chat-path' }),
      })

      expect(response.status).toBe(202)
      expect(enqueuePendingExecutionMock).toHaveBeenCalledOnce()
    })

    it.each([
      ['missing batch', { value: null }],
      ['empty batch', { value: [] }],
      ['missing client state', { value: [{ subscriptionId: 'subscription-1' }] }],
      ['non-string client state', { value: [{ clientState: { id: webhookId } }] }],
      ['forged client state', { value: [{ clientState: 'forged-webhook-id' }] }],
      [
        'mixed ownership',
        { value: [{ clientState: webhookId }, { clientState: 'forged-webhook-id' }] },
      ],
    ])('rejects a %s without queueing it', async (_name, body) => {
      const request = createMockRequest('POST', body)
      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')

      const response = await POST(request, {
        params: Promise.resolve({ path: 'teams-chat-path' }),
      })

      expect(response.status).toBe(401)
      await expect(response.text()).resolves.toBe('Unauthorized - Invalid client state')
      expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
    })
  })

  it('should handle 404 for non-existent webhooks', async () => {
    vi.doMock('@/lib/webhooks/processor', () =>
      createWebhookProcessorMock(vi.fn().mockResolvedValue(null))
    )

    const req = createMockRequest('POST', { event: 'test' })
    const params = Promise.resolve({ path: 'non-existent-path' })
    const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
    const response = await POST(req, { params })
    expect(response.status).toBe(404)
    const text = await response.text()
    expect(text).toMatch(/not found/i)
  }, 10000)

  describe('Generic Webhook Authentication', () => {
    // Mock billing and rate limiting dependencies
    beforeEach(() => {
      vi.doMock('@/lib/billing/core/subscription', () => ({
        getEffectiveSubscription: vi.fn().mockResolvedValue({
          billingTierId: 'tier_user_fixed',
          status: 'active',
          tier: {
            id: 'tier_user_fixed',
            ownerType: 'user',
          },
        }),
      }))

      vi.doMock('@/lib/billing', () => ({
        checkServerSideUsageLimits: vi.fn().mockResolvedValue(null),
      }))
    })

    /**
     * Test generic webhook without authentication (default behavior)
     */
    it('should process generic webhook without authentication', { timeout: 10_000 }, async () => {
      // Configure mock data
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: false },
        workflowId: 'test-workflow-id',
        blockId: 'generic-trigger-id',
        rateLimitCount: 100,
        rateLimitPeriod: 60,
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        pinnedApiKeyId: 'test-pinned-api-key-id',
      })

      const req = createMockRequest('POST', { event: 'test', id: 'test-123' })
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      // Should succeed (200 OK with webhook processed message)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.message).toBe('Webhook processed')
    })

    /**
     * Test generic webhook with Bearer token authentication (no custom header)
     */
    it('should authenticate with Bearer token when no custom header is configured', async () => {
      // Configure mock data with Bearer token
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'test-token-123' },
        workflowId: 'test-workflow-id',
        blockId: 'generic-trigger-id',
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        pinnedApiKeyId: 'test-pinned-api-key-id',
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-123',
      }
      const req = createMockRequest('POST', { event: 'bearer.test' }, headers)
      Object.defineProperty(req, 'url', {
        value: 'http://localhost:3000/api/webhooks/trigger/test-path?validationToken=collision',
      })
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(200)
      expect(enqueuePendingExecutionMock).toHaveBeenCalledOnce()
    })

    /**
     * Test generic webhook with custom header authentication
     */
    it('should authenticate with custom header when configured', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'secret-token-456',
          secretHeaderName: 'X-Custom-Auth',
        },
        workflowId: 'test-workflow-id',
        blockId: 'generic-trigger-id',
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        pinnedApiKeyId: 'test-pinned-api-key-id',
      })

      const headers = {
        'Content-Type': 'application/json',
        'X-Custom-Auth': 'secret-token-456',
      }
      const req = createMockRequest('POST', { event: 'custom.header.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(200)
    })

    /**
     * Test case insensitive Bearer token authentication
     */
    it('should handle case insensitive Bearer token authentication', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'case-test-token' },
        workflowId: 'test-workflow-id',
        blockId: 'generic-trigger-id',
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        pinnedApiKeyId: 'test-pinned-api-key-id',
      })

      const testCases = [
        'Bearer case-test-token',
        'bearer case-test-token',
        'BEARER case-test-token',
        'BeArEr case-test-token',
      ]

      for (const authHeader of testCases) {
        const headers = {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        }
        const req = createMockRequest('POST', { event: 'case.test' }, headers)
        const params = Promise.resolve({ path: 'test-path' })

        const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
        const response = await POST(req, { params })

        expect(response.status).toBe(200)
      }
    })

    /**
     * Test case insensitive custom header authentication
     */
    it('should handle case insensitive custom header authentication', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'custom-token-789',
          secretHeaderName: 'X-Secret-Key',
        },
        workflowId: 'test-workflow-id',
        blockId: 'generic-trigger-id',
      })
      globalMockData.workflows.push({
        id: 'test-workflow-id',
        userId: 'test-user-id',
        pinnedApiKeyId: 'test-pinned-api-key-id',
      })

      const testCases = ['X-Secret-Key', 'x-secret-key', 'X-SECRET-KEY', 'x-Secret-Key']

      for (const headerName of testCases) {
        const headers = {
          'Content-Type': 'application/json',
          [headerName]: 'custom-token-789',
        }
        const req = createMockRequest('POST', { event: 'custom.case.test' }, headers)
        const params = Promise.resolve({ path: 'test-path' })

        const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
        const response = await POST(req, { params })

        expect(response.status).toBe(200)
      }
    })

    /**
     * Test rejection of wrong Bearer token
     */
    it('should reject wrong Bearer token', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'correct-token' },
        workflowId: 'test-workflow-id',
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      }
      const req = createMockRequest('POST', { event: 'wrong.token.test' }, headers)
      Object.defineProperty(req, 'url', {
        value: 'http://localhost:3000/api/webhooks/trigger/test-path?validationToken=collision',
      })
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
    })

    /**
     * Test rejection of wrong custom header token
     */
    it('should reject wrong custom header token', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'correct-custom-token',
          secretHeaderName: 'X-Auth-Key',
        },
        workflowId: 'test-workflow-id',
      })

      const headers = {
        'Content-Type': 'application/json',
        'X-Auth-Key': 'wrong-custom-token',
      }
      const req = createMockRequest('POST', { event: 'wrong.custom.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
    })

    /**
     * Test rejection of missing authentication
     */
    it('should reject missing authentication when required', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true, token: 'required-token' },
        workflowId: 'test-workflow-id',
      })

      const req = createMockRequest('POST', { event: 'no.auth.test' })
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
    })

    /**
     * Test exclusivity - Bearer token should be rejected when custom header is configured
     */
    it('should reject Bearer token when custom header is configured', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'exclusive-token',
          secretHeaderName: 'X-Only-Header',
        },
        workflowId: 'test-workflow-id',
      })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer exclusive-token', // Correct token but wrong header type
      }
      const req = createMockRequest('POST', { event: 'exclusivity.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
    })

    /**
     * Test wrong custom header name is rejected
     */
    it('should reject wrong custom header name', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: {
          requireAuth: true,
          token: 'correct-token',
          secretHeaderName: 'X-Expected-Header',
        },
        workflowId: 'test-workflow-id',
      })

      const headers = {
        'Content-Type': 'application/json',
        'X-Wrong-Header': 'correct-token', // Correct token but wrong header name
      }
      const req = createMockRequest('POST', { event: 'wrong.header.name.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized - Invalid authentication token')
      expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
    })

    /**
     * Test authentication required but no token configured
     */
    it('should reject when auth is required but no token is configured', async () => {
      globalMockData.webhooks.push({
        id: 'generic-webhook-id',
        provider: 'generic',
        path: 'test-path',
        isActive: true,
        providerConfig: { requireAuth: true },
        workflowId: 'test-workflow-id',
      })
      globalMockData.workflows.push({ id: 'test-workflow-id', userId: 'test-user-id' })

      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer any-token',
      }
      const req = createMockRequest('POST', { event: 'no.token.config.test' }, headers)
      const params = Promise.resolve({ path: 'test-path' })

      const { POST } = await import('@/app/api/webhooks/trigger/[path]/route')
      const response = await POST(req, { params })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain(
        'Unauthorized - Authentication required but not configured'
      )
      expect(enqueuePendingExecutionMock).not.toHaveBeenCalled()
    })
  })
})
