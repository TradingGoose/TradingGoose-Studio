import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TradingGooseClient, TradingGooseError } from './index'

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}))

type FetchMock = {
  mockResolvedValue: (value: unknown) => void
  mockResolvedValueOnce: (value: unknown) => void
  mockRejectedValue: (error: unknown) => void
  mock: {
    calls: Array<[unknown, any?]>
  }
}

const getFetchMock = async (): Promise<FetchMock> =>
  (await import('node-fetch')).default as unknown as FetchMock

describe('TradingGooseClient', () => {
  let client: TradingGooseClient

  beforeEach(() => {
    client = new TradingGooseClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://test.tradinggoose.ai',
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create a client with correct configuration', () => {
      expect(client).toBeInstanceOf(TradingGooseClient)
    })

    it('should use default base URL when not provided', () => {
      const defaultClient = new TradingGooseClient({
        apiKey: 'test-api-key',
      })
      expect(defaultClient).toBeInstanceOf(TradingGooseClient)
      expect((defaultClient as any).baseUrl).toBe('https://www.tradinggoose.ai')
    })
  })

  describe('setApiKey', () => {
    it('should update the API key', () => {
      const newApiKey = 'new-api-key'
      client.setApiKey(newApiKey)

      // Verify the method exists
      expect(client.setApiKey).toBeDefined()
      // Verify the API key was actually updated
      expect((client as any).apiKey).toBe(newApiKey)
    })
  })

  describe('setBaseUrl', () => {
    it('should update the base URL', () => {
      const newBaseUrl = 'https://new.tradinggoose.ai'
      client.setBaseUrl(newBaseUrl)
      expect((client as any).baseUrl).toBe(newBaseUrl)
    })

    it('should strip trailing slash from base URL', () => {
      const urlWithSlash = 'https://test.tradinggoose.ai/'
      client.setBaseUrl(urlWithSlash)
      // Verify the trailing slash was actually stripped
      expect((client as any).baseUrl).toBe('https://test.tradinggoose.ai')
    })
  })

  describe('validateWorkflow', () => {
    it('should return false when workflow status request fails', async () => {
      const fetchMock = await getFetchMock()
      fetchMock.mockRejectedValue(new Error('Network error'))

      const result = await client.validateWorkflow('test-workflow-id')
      expect(result).toBe(false)
    })

    it('should return true when workflow is deployed', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          isDeployed: true,
          deployedAt: '2023-01-01T00:00:00Z',
          needsRedeployment: false,
        }),
      }
      fetchMock.mockResolvedValue(mockResponse as any)

      const result = await client.validateWorkflow('test-workflow-id')
      expect(result).toBe(true)
    })

    it('should return false when workflow is not deployed', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          isDeployed: false,
          deployedAt: null,
          needsRedeployment: true,
        }),
      }
      fetchMock.mockResolvedValue(mockResponse as any)

      const result = await client.validateWorkflow('test-workflow-id')
      expect(result).toBe(false)
    })
  })

  describe('executeWorkflow', () => {
    it('should execute in Node runtimes without a global File constructor', async () => {
      vi.stubGlobal('File', undefined)
      const fetchMock = await getFetchMock()
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ success: true, output: {} }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })

      await expect(
        client.executeWorkflow('workflow-id', { input: { message: 'Hello' } })
      ).resolves.toEqual({ success: true, output: {} })
    })

    it('should return WorkflowExecutionResult', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'completed' },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      fetchMock.mockResolvedValue(mockResponse as any)

      const result = await client.executeWorkflow('workflow-id', {
        input: { message: 'Hello' },
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('output')
      expect(result).not.toHaveProperty('taskId')
      expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
        input: { message: 'Hello' },
      })
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
    })

    it('should keep workflow fields isolated inside the input envelope', async () => {
      const fetchMock = await getFetchMock()
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ success: true, output: {} }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })
      const input = {
        input: 'workflow input field',
        stream: 'workflow stream field',
        selectedOutputs: ['workflow output field'],
      }

      await client.executeWorkflow('workflow-id', { input })

      expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ input })
    })

    it('should clear the timeout after a completed request', async () => {
      vi.useFakeTimers()
      const fetchMock = await getFetchMock()
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ success: true, output: {} }),
        headers: { get: vi.fn().mockReturnValue(null) },
      })

      await client.executeWorkflow('workflow-id', { timeout: 10_000 })

      expect(vi.getTimerCount()).toBe(0)
    })

    it('should report an aborted request as a timeout', async () => {
      const fetchMock = await getFetchMock()
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      fetchMock.mockRejectedValue(abortError)

      await expect(client.executeWorkflow('workflow-id')).rejects.toMatchObject({
        code: 'TIMEOUT',
      })
    })

    it('should return a typed custom body for a workflow with a Response block', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ message: 'accepted', requestId: 'request-1' }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      fetchMock.mockResolvedValue(mockResponse as any)

      const result = await client.executeWorkflow<{ message: string; requestId: string }>(
        'workflow-id'
      )

      expect(result.message).toBe('accepted')
      expect(result.requestId).toBe('request-1')
    })
  })

  describe('executeWithRetry', () => {
    it('should succeed on first attempt when no rate limit', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'success' },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      fetchMock.mockResolvedValue(mockResponse as any)

      const result = await client.executeWithRetry('workflow-id', {
        input: { message: 'test' },
      })

      expect(result).toHaveProperty('success', true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should retry on rate limit error', async () => {
      const fetchMock = await getFetchMock()
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      // First call returns 429, second call succeeds
      const rateLimitResponse = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: vi.fn().mockResolvedValue({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
        headers: {
          get: vi.fn((header: string) => {
            if (header === 'retry-after') return '1'
            if (header === 'x-ratelimit-limit') return '100'
            if (header === 'x-ratelimit-remaining') return '0'
            if (header === 'x-ratelimit-reset') return '2026-09-03T18:31:00.000Z'
            return null
          }),
        },
      }

      const successResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'success' },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      fetchMock
        .mockResolvedValueOnce(rateLimitResponse as any)
        .mockResolvedValueOnce(successResponse as any)

      const result = await client.executeWithRetry(
        'workflow-id',
        { input: { message: 'test' } },
        { maxRetries: 3, initialDelay: 10 }
      )

      expect(result).toHaveProperty('success', true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
    })

    it('should throw after max retries exceeded', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: vi.fn().mockResolvedValue({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
        headers: {
          get: vi.fn((header: string) => {
            if (header === 'retry-after') return '1'
            return null
          }),
        },
      }

      fetchMock.mockResolvedValue(mockResponse as any)

      await expect(
        client.executeWithRetry(
          'workflow-id',
          { input: { message: 'test' } },
          { maxRetries: 2, initialDelay: 10 }
        )
      ).rejects.toThrow('Rate limit exceeded')

      expect(fetchMock).toHaveBeenCalledTimes(3) // Initial + 2 retries
      expect(client.getRateLimitInfo()?.retryAfter).toBe(1000)
    })

    it('should not retry on non-rate-limit errors', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({
          error: 'Server error',
          code: 'INTERNAL_ERROR',
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      fetchMock.mockResolvedValue(mockResponse as any)

      await expect(
        client.executeWithRetry('workflow-id', { input: { message: 'test' } })
      ).rejects.toThrow('Server error')

      expect(fetchMock).toHaveBeenCalledTimes(1) // No retries
    })
  })

  describe('getRateLimitInfo', () => {
    it('should return null when no rate limit info available', () => {
      const info = client.getRateLimitInfo()
      expect(info).toBeNull()
    })

    it('should return rate limit info after API call', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ success: true, output: {} }),
        headers: {
          get: vi.fn((header: string) => {
            if (header === 'x-ratelimit-limit') return '100'
            if (header === 'x-ratelimit-remaining') return '95'
            if (header === 'x-ratelimit-reset') return '2026-09-03T18:31:00.000Z'
            return null
          }),
        },
      }

      fetchMock.mockResolvedValue(mockResponse as any)

      await client.executeWorkflow('workflow-id', { input: {} })

      const info = client.getRateLimitInfo()
      expect(info).not.toBeNull()
      expect(info?.limit).toBe(100)
      expect(info?.remaining).toBe(95)
      expect(info?.reset).toBe('2026-09-03T18:31:00.000Z')
    })

    it('should accept zero and HTTP-date Retry-After values without retaining stale data', async () => {
      const fetchMock = await getFetchMock()
      const response = (retryAfter: string | null) => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: vi.fn().mockResolvedValue({ error: 'Rate limited' }),
        headers: {
          get: vi.fn((header: string) => (header === 'retry-after' ? retryAfter : null)),
        },
      })

      fetchMock.mockResolvedValue(response('0'))
      await expect(client.executeWorkflow('workflow-id')).rejects.toThrow('Retry after 0ms')
      expect(client.getRateLimitInfo()?.retryAfter).toBe(0)

      const now = Date.now()
      fetchMock.mockResolvedValue(response(new Date(now + 2_000).toUTCString()))
      await expect(client.executeWorkflow('workflow-id')).rejects.toThrow('Retry after')
      expect(client.getRateLimitInfo()?.retryAfter).toBeGreaterThan(0)

      fetchMock.mockResolvedValue(response('invalid'))
      await expect(client.executeWorkflow('workflow-id')).rejects.toThrow('Retry after 1000ms')
      expect(client.getRateLimitInfo()).toBeNull()
    })
  })

  describe('getUsageLimits', () => {
    it('should fetch usage limits with correct structure', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          rateLimit: {
            sync: {
              isLimited: false,
              limit: 100,
              remaining: 95,
              resetAt: '2024-01-01T01:00:00Z',
            },
            async: {
              isLimited: false,
              limit: 50,
              remaining: 48,
              resetAt: '2024-01-01T01:00:00Z',
            },
            authType: 'api',
          },
          usage: {
            currentPeriodCost: 1.23,
            limit: 100.0,
            tier: { id: 'tier-pro', displayName: 'Pro' },
          },
          storage: {
            usedBytes: 1_000,
            limitBytes: 10_000,
            percentUsed: 10,
          },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      fetchMock.mockResolvedValue(mockResponse as any)

      const result = await client.getUsageLimits()

      expect(result.success).toBe(true)
      expect(result.rateLimit.sync.limit).toBe(100)
      expect(result.rateLimit.async.limit).toBe(50)
      expect(result.usage.currentPeriodCost).toBe(1.23)
      expect(result.usage.tier).toEqual({ id: 'tier-pro', displayName: 'Pro' })
      expect(result.storage.usedBytes).toBe(1_000)
      expect(result.storage.limitBytes).toBe(10_000)
      expect(result.storage.percentUsed).toBe(10)

      // Verify correct endpoint was called
      const calls = fetchMock.mock.calls
      expect(calls[0][0]).toBe('https://test.tradinggoose.ai/api/users/me/usage-limits')
    })

    it('should handle unauthorized error', async () => {
      const fetchMock = await getFetchMock()
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({
          error: 'Invalid API key',
          code: 'UNAUTHORIZED',
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      fetchMock.mockResolvedValue(mockResponse as any)

      await expect(client.getUsageLimits()).rejects.toThrow(TradingGooseError)
      await expect(client.getUsageLimits()).rejects.toThrow('Invalid API key')
    })
  })
})

describe('TradingGooseError', () => {
  it('should create error with message', () => {
    const error = new TradingGooseError('Test error')
    expect(error.message).toBe('Test error')
    expect(error.name).toBe('TradingGooseError')
  })

  it('should create error with code and status', () => {
    const error = new TradingGooseError('Test error', 'TEST_CODE', 400)
    expect(error.message).toBe('Test error')
    expect(error.code).toBe('TEST_CODE')
    expect(error.status).toBe(400)
  })
})
