import { NextRequest } from 'next/server'
/**
 * Integration tests for workflow execution API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Workflow Execution API Route', () => {
  class MockExecutionGateError extends Error {
    statusCode: number
    constructor(message: string, statusCode = 402) {
      super(message)
      this.name = 'ExecutionGateError'
      this.statusCode = statusCode
    }
  }

  class MockRateLimitError extends Error {
    statusCode: number
    constructor(message: string, statusCode = 429) {
      super(message)
      this.name = 'RateLimitError'
      this.statusCode = statusCode
    }
  }

  let executeMock = vi.fn().mockResolvedValue({
    success: true,
    output: {
      response: 'Test response',
    },
    logs: [],
    metadata: {
      duration: 123,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
    },
  })
  let enforceServerExecutionRateLimitMock = vi.fn()
  let checkServerSideUsageLimitsMock = vi.fn()
  let authenticateApiKeyFromHeaderMock = vi.fn()
  let updateApiKeyLastUsedMock = vi.fn()
  let withExecutionConcurrencyLimitMock = vi.fn()
  let withExecutionConcurrencyControllerMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    enforceServerExecutionRateLimitMock = vi.fn().mockResolvedValue(undefined)
    authenticateApiKeyFromHeaderMock = vi.fn().mockResolvedValue({
      success: true,
      userId: 'user-id',
      keyId: 'api-key-id',
    })
    checkServerSideUsageLimitsMock = vi.fn().mockResolvedValue({
      isExceeded: false,
      currentUsage: 10,
      limit: 100,
    })
    updateApiKeyLastUsedMock = vi.fn().mockResolvedValue(undefined)
    withExecutionConcurrencyLimitMock = vi.fn(
      async ({ task }: { task: () => Promise<unknown> }) => await task(),
    )
    withExecutionConcurrencyControllerMock = vi.fn(
      async ({
        task,
      }: {
        task: (controller: {
          runWithoutLease: <T>(releasedTask: () => Promise<T>) => Promise<T>
        }) => Promise<unknown>
      }) =>
        await task({
          runWithoutLease: async <T>(releasedTask: () => Promise<T>) =>
            await releasedTask(),
        }),
    )

    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-id',
          userId: 'user-id',
          workspaceId: null,
        },
      }),
    }))

    vi.doMock('@/lib/auth', () => ({
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-id' },
      }),
    }))

    vi.doMock('@/lib/api-key/service', () => ({
      authenticateApiKeyFromHeader: (...args: any[]) =>
        authenticateApiKeyFromHeaderMock(...args),
      updateApiKeyLastUsed: (...args: any[]) =>
        updateApiKeyLastUsedMock(...args),
    }))

    vi.doMock('@/services/queue', () => ({
      RateLimitError: MockRateLimitError,
    }))

    vi.doMock('@/lib/billing', () => ({
      checkServerSideUsageLimits: (...args: any[]) =>
        checkServerSideUsageLimitsMock(...args),
    }))

    vi.doMock('@/lib/execution/execution-concurrency-limit', () => ({
      ExecutionGateError: MockExecutionGateError,
      enforceServerExecutionRateLimit: (...args: any[]) =>
        enforceServerExecutionRateLimitMock(...args),
      withExecutionConcurrencyLimit: (...args: any[]) =>
        withExecutionConcurrencyLimitMock(...args),
      withExecutionConcurrencyController: (...args: any[]) =>
        withExecutionConcurrencyControllerMock(...args),
    }))

    vi.doMock('@/lib/environment/utils', () => ({
      getPersonalAndWorkspaceEnv: vi.fn().mockResolvedValue({
        personalEncrypted: {},
        workspaceEncrypted: {},
      }),
    }))

    vi.doMock('@/lib/execution/files', () => ({
      processExecutionFiles: vi.fn().mockResolvedValue([]),
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      subscription: {
        billingTierId: 'billingTierId',
        referenceId: 'referenceId',
      },
      apiKey: {
        userId: 'userId',
        key: 'key',
      },
      userStats: {
        userId: 'userId',
        totalApiCalls: 'totalApiCalls',
        lastActive: 'lastActive',
      },
      environment: {
        userId: 'userId',
        variables: 'variables',
      },
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadDeployedWorkflowState: vi.fn().mockResolvedValue({
        blocks: {
          'trigger-id': {
            id: 'trigger-id',
            type: 'api_trigger',
            name: 'API Trigger',
            position: { x: 100, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
          'agent-id': {
            id: 'agent-id',
            type: 'agent',
            name: 'Agent',
            position: { x: 300, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
        },
        edges: [
          {
            id: 'edge-1',
            source: 'trigger-id',
            target: 'agent-id',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
        loops: {},
        parallels: {},
        isFromNormalizedTables: false, // Changed to false since it's from deployed state
      }),
    }))

    executeMock = vi.fn().mockResolvedValue({
      success: true,
      output: {
        response: 'Test response',
      },
      logs: [],
      metadata: {
        duration: 123,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
      },
    })

    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: executeMock,
      })),
    }))

    vi.doMock('@/lib/utils', () => ({
      isHosted: vi.fn().mockReturnValue(false),
      generateRequestId: vi.fn(() => 'test-request-id'),
    }))

    vi.doMock('@/lib/utils-server', () => ({
      decryptSecret: vi.fn().mockResolvedValue({
        decrypted: 'decrypted-secret-value',
      }),
      getRotatingApiKey: vi.fn().mockReturnValue('rotated-api-key'),
    }))

    vi.doMock('@/lib/logs/execution/logging-session', () => ({
      LoggingSession: vi.fn().mockImplementation(() => ({
        safeStart: vi.fn().mockResolvedValue(undefined),
        safeComplete: vi.fn().mockResolvedValue(undefined),
        safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
        setupExecutor: vi.fn(),
      })),
    }))

    vi.doMock('@/lib/logs/execution/logger', () => ({
      executionLogger: {
        startWorkflowExecution: vi.fn().mockResolvedValue(undefined),
        logBlockExecution: vi.fn().mockResolvedValue(undefined),
        completeWorkflowExecution: vi.fn().mockResolvedValue(undefined),
      },
    }))

    vi.doMock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
      buildTraceSpans: vi.fn().mockReturnValue({
        traceSpans: [],
        totalDuration: 100,
      }),
    }))

    vi.doMock('@/lib/workflows/utils', () => ({
      updateWorkflowRunCounts: vi.fn().mockResolvedValue(undefined),
      workflowHasResponseBlock: vi.fn().mockReturnValue(false),
      createHttpResponseFromBlock: vi.fn().mockReturnValue(new Response('OK')),
    }))

    vi.doMock('@/stores/workflows/server-utils', () => ({
      mergeSubblockState: vi.fn().mockReturnValue({
        'trigger-id': {
          id: 'trigger-id',
          type: 'api_trigger',
          subBlocks: {},
        },
        'agent-id': {
          id: 'agent-id',
          type: 'agent',
          subBlocks: {},
        },
      }),
    }))

    vi.doMock('@tradinggoose/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation((columns) => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                if (table === 'subscription' || columns?.billingTierId) {
                  return [{ billingTierId: 'tier_default' }]
                }
                if (table === 'apiKey' || columns?.userId) {
                  return [{ userId: 'user-id' }]
                }
                return [
                  {
                    id: 'env-id',
                    userId: 'user-id',
                    variables: {
                      OPENAI_API_KEY: 'encrypted:key-value',
                    },
                  },
                ]
              }),
            })),
          })),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockResolvedValue(undefined),
          })),
        })),
      }

      return { db: mockDb }
    })

    vi.doMock('@/serializer', () => ({
      Serializer: vi.fn().mockImplementation(() => ({
        serializeWorkflow: vi.fn().mockReturnValue({
          version: '1.0',
          blocks: [
            {
              id: 'trigger-id',
              position: { x: 100, y: 100 },
              config: { tool: 'api_trigger', params: {} },
              inputs: {},
              outputs: {},
              enabled: true,
              metadata: {
                id: 'api_trigger',
                name: 'API Trigger',
                category: 'triggers',
              },
            },
            {
              id: 'agent-id',
              position: { x: 300, y: 100 },
              config: { tool: 'agent', params: {} },
              inputs: {},
              outputs: {},
              enabled: true,
              metadata: { id: 'agent', name: 'Agent' },
            },
          ],
          connections: [{ source: 'trigger-id', target: 'agent-id' }],
          loops: {},
          parallels: {},
        }),
      })),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Test GET execution route
   * Simulates direct execution with URL-based parameters
   */
  it('should execute workflow with GET request successfully', async () => {
    const req = createMockRequest('GET')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { GET } = await import('@/app/api/workflows/[id]/execute/route')

    const response = await GET(req, { params })

    expect(response).toBeDefined()

    let data
    try {
      data = await response.json()
    } catch (e) {
      console.error(
        'Response could not be parsed as JSON:',
        await response.text(),
      )
      throw e
    }

    if (response.status === 200) {
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('output')
      expect(data.output).toHaveProperty('response')
    }

    const validateWorkflowAccess = (
      await import('@/app/api/workflows/middleware')
    ).validateWorkflowAccess
    expect(validateWorkflowAccess).toHaveBeenCalledWith(
      expect.any(Object),
      'workflow-id',
    )

    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalled()

    expect(executeMock).toHaveBeenCalledWith('workflow-id', 'trigger-id')
  })

  /**
   * Test POST execution route
   * Simulates execution with a JSON body containing parameters
   */
  it('should execute workflow with POST request successfully', async () => {
    const requestBody = {
      inputs: {
        message: 'Test input message',
      },
    }

    const req = createMockRequest('POST', requestBody)

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('@/app/api/workflows/[id]/execute/route')

    const response = await POST(req, { params })

    expect(response).toBeDefined()

    let data
    try {
      data = await response.json()
    } catch (e) {
      console.error(
        'Response could not be parsed as JSON:',
        await response.text(),
      )
      throw e
    }

    if (response.status === 200) {
      expect(data).toHaveProperty('success', true)
      expect(data).toHaveProperty('output')
      expect(data.output).toHaveProperty('response')
    }

    const validateWorkflowAccess = (
      await import('@/app/api/workflows/middleware')
    ).validateWorkflowAccess
    expect(validateWorkflowAccess).toHaveBeenCalledWith(
      expect.any(Object),
      'workflow-id',
    )

    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalled()

    expect(executeMock).toHaveBeenCalledWith('workflow-id', 'trigger-id')

    expect(Executor).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: expect.any(Object), // serializedWorkflow
        currentBlockStates: expect.any(Object), // processedBlockStates
        envVarValues: expect.any(Object), // decryptedEnvVars
        workflowInput: requestBody, // processedInput (direct input, not wrapped)
        workflowVariables: expect.any(Object),
        contextExtensions: expect.objectContaining({
          userId: 'user-id',
          concurrencyLeaseInherited: true,
        }),
      }),
    )
  })

  /**
   * Test POST execution with structured input matching the input format
   */
  it('should execute workflow with structured input matching the input format', async () => {
    const structuredInput = {
      firstName: 'John',
      age: 30,
      isActive: true,
      preferences: { theme: 'dark' },
      tags: ['test', 'api'],
    }

    const req = createMockRequest('POST', structuredInput)

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('@/app/api/workflows/[id]/execute/route')

    const response = await POST(req, { params })

    expect(response).toBeDefined()
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('success', true)

    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: expect.any(Object), // serializedWorkflow
        currentBlockStates: expect.any(Object), // processedBlockStates
        envVarValues: expect.any(Object), // decryptedEnvVars
        workflowInput: structuredInput, // processedInput (direct input, not wrapped)
        workflowVariables: expect.any(Object),
        contextExtensions: expect.any(Object), // Allow any context extensions object
      }),
    )
  })

  /**
   * Test POST execution with empty request body
   */
  it('should execute workflow with empty request body', async () => {
    const req = createMockRequest('POST')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('@/app/api/workflows/[id]/execute/route')

    const response = await POST(req, { params })

    expect(response).toBeDefined()
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('success', true)

    const Executor = (await import('@/executor')).Executor
    expect(Executor).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: expect.any(Object), // serializedWorkflow
        currentBlockStates: expect.any(Object), // processedBlockStates
        envVarValues: expect.any(Object), // decryptedEnvVars
        workflowInput: expect.objectContaining({}), // processedInput with empty input
        workflowVariables: expect.any(Object),
        contextExtensions: expect.any(Object), // Allow any context extensions object
      }),
    )
  })

  /**
   * Test POST execution with invalid JSON body
   */
  it('should handle invalid JSON in request body', async () => {
    // Create a mock request with invalid JSON text
    const req = new NextRequest(
      'https://example.com/api/workflows/workflow-id/execute',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'this is not valid JSON',
      },
    )

    const params = Promise.resolve({ id: 'workflow-id' })

    const { POST } = await import('@/app/api/workflows/[id]/execute/route')

    const response = await POST(req, { params })

    expect(response.status).toBe(400)

    const data = await response.json()
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('Invalid JSON')
  })

  /**
   * Test handling of incorrect workflow ID
   */
  it('should return 403 for unauthorized workflow access', async () => {
    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        error: {
          message: 'Unauthorized',
          status: 403,
        },
      }),
    }))

    const req = createMockRequest('GET')

    const params = Promise.resolve({ id: 'invalid-workflow-id' })

    const { GET } = await import('@/app/api/workflows/[id]/execute/route')

    const response = await GET(req, { params })

    expect(response.status).toBe(403)

    const data = await response.json()
    expect(data).toHaveProperty('error', 'Unauthorized')
  })

  /**
   * Test handling of execution errors
   */
  it('should handle execution errors gracefully', async () => {
    const mockCompleteWorkflowExecution = vi.fn().mockResolvedValue({})
    vi.doMock('@/lib/logs/execution/logger', () => ({
      executionLogger: {
        completeWorkflowExecution: mockCompleteWorkflowExecution,
      },
    }))

    const mockSafeCompleteWithError = vi.fn().mockResolvedValue({})
    vi.doMock('@/lib/logs/execution/logging-session', () => ({
      LoggingSession: vi.fn().mockImplementation(() => ({
        safeStart: vi.fn().mockResolvedValue({}),
        safeComplete: vi.fn().mockResolvedValue({}),
        safeCompleteWithError: mockSafeCompleteWithError,
        setupExecutor: vi.fn(),
      })),
    }))

    vi.doMock('@/executor', () => ({
      Executor: vi.fn().mockImplementation(() => ({
        execute: vi.fn().mockRejectedValue(new Error('Execution failed')),
      })),
    }))

    const req = createMockRequest('GET')

    const params = Promise.resolve({ id: 'workflow-id' })

    const { GET } = await import('@/app/api/workflows/[id]/execute/route')

    const response = await GET(req, { params })

    expect(response.status).toBe(500)

    const data = await response.json()
    expect(data).toHaveProperty('error')
    expect(data.error).toContain('Execution failed')

    expect(mockSafeCompleteWithError).toHaveBeenCalled()
  })

  /**
   * Test that workflow variables are properly passed to the Executor
   */
  it('should pass workflow variables to the Executor', async () => {
    const workflowVariables = {
      variable1: {
        id: 'var1',
        name: 'variable1',
        type: 'string',
        value: '"test value"',
      },
      variable2: {
        id: 'var2',
        name: 'variable2',
        type: 'boolean',
        value: 'true',
      },
    }

    vi.doMock('@/app/api/workflows/middleware', () => ({
      validateWorkflowAccess: vi.fn().mockResolvedValue({
        workflow: {
          id: 'workflow-with-vars-id',
          userId: 'user-id',
          workspaceId: null,
          variables: workflowVariables,
        },
      }),
    }))

    vi.doMock('@/lib/workflows/db-helpers', () => ({
      loadDeployedWorkflowState: vi.fn().mockResolvedValue({
        blocks: {
          'trigger-id': {
            id: 'trigger-id',
            type: 'input_trigger',
            name: 'Start',
            position: { x: 100, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
          'agent-id': {
            id: 'agent-id',
            type: 'agent',
            name: 'Agent',
            position: { x: 300, y: 100 },
            enabled: true,
            subBlocks: {},
            outputs: {},
            data: {},
          },
        },
        edges: [
          {
            id: 'edge-1',
            source: 'trigger-id',
            target: 'agent-id',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
        loops: {},
        parallels: {},
        isFromNormalizedTables: false, // Changed to false since it's from deployed state
      }),
    }))

    const executorConstructorMock = vi.fn().mockImplementation(() => ({
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: { response: 'Execution completed with variables' },
        logs: [],
        metadata: {
          duration: 100,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
        },
      }),
    }))

    vi.doMock('@/executor', () => ({
      Executor: executorConstructorMock,
    }))

    const req = createMockRequest('POST', { testInput: 'value' })

    const params = Promise.resolve({ id: 'workflow-with-vars-id' })

    const { POST } = await import('@/app/api/workflows/[id]/execute/route')

    await POST(req, { params })

    expect(executorConstructorMock).toHaveBeenCalled()

    const executorCalls = executorConstructorMock.mock.calls
    expect(executorCalls.length).toBeGreaterThan(0)

    const lastCall = executorCalls[executorCalls.length - 1]
    expect(lastCall.length).toBeGreaterThanOrEqual(1)

    // Check that workflowVariables are passed in the options object
    expect(lastCall[0]).toEqual(
      expect.objectContaining({
        workflowVariables: workflowVariables,
      }),
    )
  })

  it('returns a usage-limit response when api execution cannot resolve billing context', async () => {
    enforceServerExecutionRateLimitMock.mockRejectedValueOnce(
      new MockExecutionGateError(
        'No active subscription found for this workspace. Please configure billing before executing workflows.',
      ),
    )

    const { getSession } = await import('@/lib/auth')
    vi.mocked(getSession).mockResolvedValueOnce(null)

    const req = new NextRequest(
      'https://example.com/api/workflows/workflow-id/execute',
      {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-api-key',
        },
      },
    )
    const params = Promise.resolve({ id: 'workflow-id' })

    const { GET } = await import('@/app/api/workflows/[id]/execute/route')
    const response = await GET(req, { params })
    const payload = await response.json()

    expect(response.status).toBe(402)
    expect(payload.code).toBe('USAGE_LIMIT_EXCEEDED')
    expect(payload.error).toContain(
      'No active subscription found for this workspace',
    )
  })

})
