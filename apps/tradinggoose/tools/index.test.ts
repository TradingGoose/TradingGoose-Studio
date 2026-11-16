/**
 * @vitest-environment jsdom
 *
 * Tools Registry and Executor Unit Tests
 *
 * This file contains unit tests for the tools registry and executeTool function,
 * which are the central pieces of infrastructure for executing tools.
 */

import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateInternalToken } from '@/lib/auth/internal'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getBlock } from '@/blocks'
import { createMinimalWorkflow } from '@/executor/__test-utils__/executor-mocks'
import { AgentBlockHandler, createAgentToolSet } from '@/executor/handlers/agent/agent-handler'
import { buildLoadSkillTool } from '@/executor/handlers/agent/skill-loader'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import type { ExecutionContext } from '@/executor/types'
import { createMockFetch, mockEnvironmentVariables } from '@/tools/__test-utils__/test-tools'
import { executeTool } from '@/tools/index'
import { tools } from '@/tools/registry'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

const dbMocks = vi.hoisted(() => {
  let rows: unknown[] = []
  const setRows = (nextRows: unknown[]) => {
    rows = nextRows
  }
  const limit = vi.fn(() => Promise.resolve(rows))
  const orderBy = vi.fn(() => Promise.resolve(rows))
  const whereResult = {
    limit,
    orderBy,
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  const where = vi.fn(() => whereResult)
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))

  return { from, limit, orderBy, select, setRows, where }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: dbMocks.select,
  },
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockResolvedValue('mock-internal-token'),
}))

const yjsMocks = vi.hoisted(() => ({
  readSavedEntityFieldsForExecution: vi.fn(),
}))
const watchlistMocks = vi.hoisted(() => ({
  getWatchlist: vi.fn(),
  listWatchlists: vi.fn(),
}))

const permissionMocks = vi.hoisted(() => ({
  checkWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => yjsMocks)
vi.mock('@/lib/watchlists/operations', () => watchlistMocks)
vi.mock(import('@/lib/permissions/utils'), async (importOriginal) => ({
  ...(await importOriginal()),
  checkWorkspaceAccess: permissionMocks.checkWorkspaceAccess,
}))

beforeEach(() => {
  permissionMocks.checkWorkspaceAccess.mockResolvedValue({ hasAccess: true, canWrite: true })
  watchlistMocks.getWatchlist.mockReset()
  watchlistMocks.listWatchlists.mockReset()
})

// Helper function to create mock ExecutionContext
const createMockExecutionContext = (overrides?: Partial<ExecutionContext>): ExecutionContext => ({
  workflowId: 'test-workflow',
  workspaceId: 'workspace-456',
  userId: 'user-123',
  blockStates: new Map(),
  blockLogs: [],
  metadata: { startTime: new Date().toISOString(), duration: 0 },
  environmentVariables: {},
  decisions: { router: new Map(), condition: new Map() },
  loopIterations: new Map(),
  loopItems: new Map(),
  completedLoops: new Set(),
  executedBlocks: new Set(),
  activeExecutionPath: new Set(),
  ...overrides,
})

describe('Tools Registry', () => {
  it('should include all expected built-in tools', () => {
    expect(Object.keys(tools).length).toBeGreaterThan(10)

    // Check for existence of some core tools
    expect(tools.http_request).toBeDefined()
    expect(tools.function_execute).toBeDefined()

    // Check for some integrations
    expect(tools.gmail_read).toBeDefined()
    expect(tools.gmail_send).toBeDefined()
    expect(tools.google_drive_list).toBeDefined()
    expect(tools.serper_search).toBeDefined()
  })

  it('getTool should return the correct tool by ID', () => {
    const httpTool = getTool('http_request')
    expect(httpTool).toBeDefined()
    expect(httpTool?.id).toBe('http_request')
    expect(httpTool?.name).toBe('HTTP Request')

    const gmailTool = getTool('gmail_read')
    expect(gmailTool).toBeDefined()
    expect(gmailTool?.id).toBe('gmail_read')
    expect(gmailTool?.name).toBe('Gmail Read')
  })

  it('getTool should return undefined for non-existent tool', () => {
    const nonExistentTool = getTool('non_existent_tool')
    expect(nonExistentTool).toBeUndefined()
  })

  it('does not expose removed watchlist mutation tools', async () => {
    for (const toolId of ['watchlist_add_listing', 'watchlist_remove_listing']) {
      expect((tools as Record<string, unknown>)[toolId]).toBeUndefined()
      expect(getTool(toolId)).toBeUndefined()

      await expect(executeTool(toolId, {})).resolves.toMatchObject({
        success: false,
        error: `Tool not found: ${toolId}`,
      })
    }
  })

  it('forwards live watchlist execution mode', async () => {
    const watchlist = {
      id: 'watchlist-b',
      workspaceId: 'workspace-456',
      name: 'Second',
      settings: { showLogo: true, showTicker: true, showDescription: true },
      items: [],
      createdAt: '',
      updatedAt: '',
    }
    watchlistMocks.getWatchlist.mockResolvedValueOnce(watchlist)
    watchlistMocks.listWatchlists.mockResolvedValueOnce([watchlist])
    const context = {
      userId: 'user-123',
      workspaceId: 'workspace-456',
      isDeployedContext: false,
    }

    await executeTool('watchlist_read_list_items', {
      watchlistId: 'watchlist-b',
      _context: context,
    })
    expect(watchlistMocks.getWatchlist).toHaveBeenCalledWith(
      { workspaceId: 'workspace-456' },
      'watchlist-b',
      false
    )

    await executeTool('watchlist_read_lists', { _context: context })
    expect(watchlistMocks.listWatchlists).toHaveBeenCalledWith(
      { workspaceId: 'workspace-456' },
      false
    )
  })

  it('rejects direct watchlist reads when the authenticated user lacks workspace access', async () => {
    permissionMocks.checkWorkspaceAccess.mockResolvedValueOnce({
      hasAccess: false,
      canWrite: false,
    })

    await expect(
      executeTool('watchlist_read_lists', {
        _context: { userId: 'user-123', workspaceId: 'workspace-other' },
      })
    ).resolves.toMatchObject({
      success: false,
      error: 'watchlist_read_lists requires read access to the workspace',
    })
    expect(watchlistMocks.listWatchlists).not.toHaveBeenCalled()
  })
})

describe('executeTool Function', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    vi.mocked(generateInternalToken).mockResolvedValue('mock-internal-token')
    dbMocks.setRows([])
    dbMocks.select.mockImplementation(() => ({ from: dbMocks.from }))
    dbMocks.from.mockImplementation(() => ({ where: dbMocks.where }))
    dbMocks.where.mockImplementation(() => ({
      limit: dbMocks.limit,
      orderBy: dbMocks.orderBy,
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve([]).then(resolve, reject),
    }))
    dbMocks.limit.mockImplementation(() => Promise.resolve([]))
    yjsMocks.readSavedEntityFieldsForExecution.mockRejectedValue(
      new Error('Saved entity was not found')
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ success: true, output: { result: 'Direct request successful' } })
      )
    )

    // Set environment variables
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = mockEnvironmentVariables({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it('should execute a tool successfully', async () => {
    const result = await executeTool('http_request', {
      url: 'https://api.example.com/data',
      method: 'GET',
    })

    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
    expect(result.timing).toBeDefined()
    expect(result.timing?.startTime).toBeDefined()
    expect(result.timing?.endTime).toBeDefined()
    expect(result.timing?.duration).toBeGreaterThanOrEqual(0)
  })

  it.each([{ price: 123 }, false, 0])(
    'uses one current custom-tool definition for native arguments and execution: %j',
    async (value) => {
      const originalWindow = global.window
      const schema = {
        type: 'function' as const,
        function: {
          description: 'Look up a quote',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              unit: { type: 'string' },
              code: { type: 'string' },
              method: { type: 'string' },
              market: { type: 'object', properties: { exchange: { enum: ['NASDAQ'] } } },
            },
            required: ['symbol', 'code', 'method'],
          },
        },
      }
      const savedCode = 'return params.symbol'
      const context = createMockExecutionContext({
        isDeployedContext: false,
        environmentVariables: { SECRET: 'host-value' },
        workflowVariables: { market: 'NASDAQ' },
      })
      yjsMocks.readSavedEntityFieldsForExecution.mockResolvedValue({
        codeText: savedCode,
        schemaText: JSON.stringify(schema),
      })
      dbMocks.orderBy.mockResolvedValue([{ id: 'quote', name: 'Quote' }])
      global.fetch = createMockFetch({
        success: true,
        output: { result: value, stdout: 'private execution envelope' },
      }) as typeof fetch
      try {
        Object.defineProperty(global, 'window', {
          value: undefined,
          writable: true,
          configurable: true,
        })
        const selected = {
          type: 'custom-tool',
          toolId: 'custom_quote',
          title: 'Old quote',
          schema: {
            type: 'function' as const,
            function: {
              description: 'Old quote schema',
              parameters: {
                type: 'object',
                properties: { ticker: { type: 'string' } },
                required: ['ticker'],
              },
            },
          },
          code: 'throw new Error("cached code")',
          params: { unit: 'USD' },
        }
        // biome-ignore lint/complexity/useLiteralKeys: Exercise the production factory without exposing a test-only API.
        const configured = await new AgentBlockHandler()['formatTools']([selected], context)
        yjsMocks.readSavedEntityFieldsForExecution.mockResolvedValue({
          codeText: 'throw new Error("changed during the run")',
          schemaText: JSON.stringify(selected.schema),
        })
        const { tools } = createAgentToolSet(
          configured,
          createMinimalWorkflow().blocks[1],
          context,
          new AbortController()
        )
        let step = 0
        const model = new MastraLanguageModelV2Mock({
          doGenerate: async (options) => ({
            content:
              step++ === 0
                ? [
                    {
                      type: 'tool-call',
                      toolCallId: 'quote-call',
                      toolName: 'custom_quote',
                      input: JSON.stringify({
                        [(options.tools?.[0] as { inputSchema: { required: string[] } }).inputSchema
                          .required[0]]: 'AAPL',
                        code: 'business input',
                        method: 'DELETE',
                      }),
                    },
                  ]
                : [{ type: 'text', text: 'Quote received' }],
            finishReason: step === 1 ? 'tool-calls' : 'stop',
            usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
            warnings: [],
          }),
        })
        await new Agent({ id: 'quote', name: 'Quote', instructions: '', model, tools }).generate(
          'Quote',
          { maxSteps: 2 }
        )
        expect(configured[0].name).toBe('Quote')
        expect(model.doGenerateCalls[0].tools?.[0]).toMatchObject({
          inputSchema: {
            required: schema.function.parameters.required,
            properties: {
              symbol: schema.function.parameters.properties.symbol,
              market: schema.function.parameters.properties.market,
            },
          },
        })
        expect(fetch).toHaveBeenCalledOnce()
        const [url, request] = vi.mocked(fetch).mock.calls[0]
        expect(String(url)).toContain('/api/function/execute')
        expect(request?.method).toBe('POST')
        expect(request?.signal).toBeInstanceOf(AbortSignal)
        expect(JSON.parse(request!.body as string)).toMatchObject({
          code: savedCode,
          schema: schema.function.parameters,
          params: { symbol: 'AAPL', unit: 'USD', code: 'business input', method: 'DELETE' },
          envVars: context.environmentVariables,
          workflowVariables: context.workflowVariables,
          workflowId: context.workflowId,
          userId: context.userId,
          isDeployedContext: false,
          isCustomTool: true,
        })
        expect(yjsMocks.readSavedEntityFieldsForExecution).toHaveBeenCalledExactlyOnceWith(
          'custom_tool',
          'quote',
          context.workspaceId,
          false
        )
        expect(model.doGenerateCalls[1].prompt).toContainEqual(
          expect.objectContaining({
            role: 'tool',
            content: expect.arrayContaining([
              expect.objectContaining({ output: { type: 'json', value } }),
            ]),
          })
        )
      } finally {
        Object.defineProperty(global, 'window', {
          value: originalWindow,
          writable: true,
          configurable: true,
        })
      }
    }
  )

  it('overwrites untrusted Memory context with the actual workflow execution scope', async () => {
    await executeTool(
      'memory_add',
      {
        id: 'chat',
        role: 'user',
        content: 'Hello',
        workflowId: 'untrusted',
        type: 'raw',
        _context: { workflowId: 'untrusted', workspaceId: 'untrusted', userId: 'untrusted' },
      },
      false,
      createMockExecutionContext()
    )
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/api/memory'))
    expect(call).toBeDefined()
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      key: 'chat',
      type: 'agent',
      workflowId: 'test-workflow',
      data: { role: 'user', content: 'Hello' },
    })
    expect(permissionMocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-456', 'user-123')
  })

  it('rejects Memory writes without workspace write access before making a request', async () => {
    permissionMocks.checkWorkspaceAccess.mockResolvedValueOnce({ hasAccess: true, canWrite: false })
    const result = await executeTool(
      'memory_add',
      { id: 'chat', role: 'user', content: 'Hello' },
      false,
      createMockExecutionContext()
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('requires write access to the workspace')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('should call internal routes directly', async () => {
    // Mock transformResponse for function_execute tool
    const originalFunctionTool = { ...tools.function_execute }
    tools.function_execute = {
      ...tools.function_execute,
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'Function executed successfully' },
      }),
    }

    await executeTool('function_execute', {
      code: 'return { result: "hello world" }',
      language: 'javascript',
    })

    // Restore original tool
    tools.function_execute = originalFunctionTool

    // Expect transform response to have been called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/function/execute'),
      expect.anything()
    )
  })

  it('should sign internal function execution requests with the acting user id', async () => {
    const mockContext = createMockExecutionContext({ userId: 'user-123' })
    const originalWindow = global.window

    Object.defineProperty(global, 'window', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    try {
      await executeTool(
        'function_execute',
        {
          code: 'return { result: "hello world" }',
          language: 'javascript',
        },
        false,
        mockContext
      )
    } finally {
      Object.defineProperty(global, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      })
    }

    expect(vi.mocked(generateInternalToken)).toHaveBeenCalledWith('user-123')
  })

  it.each([false, true])('hydrates post-processing provenance (direct: %s)', async (direct) => {
    const originalTool = (tools as any).test_context_tool
    const postProcess = vi.fn((result) => result)
    const respond = vi.fn().mockResolvedValue({ success: true, output: { result: 'ok' } })
    ;(tools as any).test_context_tool = {
      id: 'test_context_tool',
      name: 'Test Context Tool',
      description: 'Captures execution context',
      version: '1.0.0',
      params: {},
      request: {
        url: 'https://api.example.com/context',
        method: 'GET',
      },
      ...(direct ? { directExecution: respond } : { transformResponse: respond }),
      postProcess,
    }

    try {
      await executeTool(
        'test_context_tool',
        {},
        false,
        createMockExecutionContext({
          submissionSource: 'workflow',
          userId: 'user-123',
          workflowLogId: 'log-1',
        })
      )
    } finally {
      if (originalTool) {
        ;(tools as any).test_context_tool = originalTool
      } else {
        ;(tools as any).test_context_tool = undefined
      }
    }

    expect(postProcess).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object),
      expect.objectContaining({
        _context: expect.objectContaining({
          submissionSource: 'workflow',
          userId: 'user-123',
          workflowId: 'test-workflow',
          workflowLogId: 'log-1',
          workspaceId: 'workspace-456',
        }),
      }),
      expect.any(Function)
    )
  })

  it('fails internal route execution when internal auth cannot be generated', async () => {
    const mockContext = createMockExecutionContext({ userId: 'user-123' })
    const originalWindow = global.window
    vi.mocked(generateInternalToken).mockRejectedValueOnce(new Error('token boom'))

    Object.defineProperty(global, 'window', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    try {
      const result = await executeTool(
        'function_execute',
        {
          code: 'return { result: "hello world" }',
          language: 'javascript',
        },
        false,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('token boom')
      expect(global.fetch).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(global, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      })
    }
  })

  it('fails credential token lookup before fetch when internal auth cannot be generated', async () => {
    const mockContext = createMockExecutionContext({ userId: 'user-123' })
    const originalWindow = global.window
    const originalTool = (tools as any).test_credential_tool
    vi.mocked(generateInternalToken).mockRejectedValueOnce(new Error('token boom'))
    ;(tools as any).test_credential_tool = {
      id: 'test_credential_tool',
      name: 'Test Credential Tool',
      description: 'A test tool that needs an OAuth credential token',
      version: '1.0.0',
      params: {},
      request: {
        url: '/api/tools/gmail/send',
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
    }

    Object.defineProperty(global, 'window', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    try {
      const result = await executeTool(
        'test_credential_tool',
        { credential: 'credential-1' },
        false,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to obtain credential for tool test_credential_tool')
      expect(result.error).toContain('token boom')
      expect(global.fetch).not.toHaveBeenCalled()
    } finally {
      if (originalTool) {
        ;(tools as any).test_credential_tool = originalTool
      } else {
        Reflect.deleteProperty(tools as any, 'test_credential_tool')
      }
      Object.defineProperty(global, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      })
    }
  })

  it('uses workflow-scoped internal auth for credential token lookup without user context', async () => {
    const mockContext = createMockExecutionContext({ userId: undefined })
    const originalWindow = global.window
    const originalTool = (tools as any).test_credential_tool
    ;(tools as any).test_credential_tool = {
      id: 'test_credential_tool',
      name: 'Test Credential Tool',
      description: 'A test tool that needs an OAuth credential token',
      version: '1.0.0',
      params: {},
      request: {
        url: '/api/tools/gmail/send',
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
    }

    Object.defineProperty(global, 'window', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    try {
      const result = await executeTool(
        'test_credential_tool',
        { credential: 'credential-1', _context: { toolExecutionId: 'agent-1' } },
        false,
        mockContext
      )

      expect(result.success).toBe(true)
      const workflowExecution = {
        source: 'workflow_block',
        parentWorkflowId: 'test-workflow',
        parentBlockId: 'agent-1',
      }
      expect(vi.mocked(generateInternalToken)).toHaveBeenNthCalledWith(1, undefined, {
        workflowExecution,
      })
      expect(vi.mocked(generateInternalToken)).toHaveBeenNthCalledWith(2, undefined, {
        workflowExecution,
      })
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/auth/oauth/token',
        expect.objectContaining({
          body: JSON.stringify({
            credentialId: 'credential-1',
            workflowId: 'test-workflow',
            workspaceId: 'workspace-456',
          }),
        })
      )
    } finally {
      if (originalTool) {
        ;(tools as any).test_credential_tool = originalTool
      } else {
        Reflect.deleteProperty(tools as any, 'test_credential_tool')
      }
      Object.defineProperty(global, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      })
    }
  })

  it('should load skill content from workspace storage', async () => {
    const skillLoaderTool = buildLoadSkillTool('tradinggoose_internal_load_skill', [
      {
        id: 'skill-1',
        name: 'market-research',
        description: 'Research the market before acting',
      },
    ])
    yjsMocks.readSavedEntityFieldsForExecution.mockResolvedValueOnce({
      id: 'skill-1',
      name: 'market-research',
      description: 'Research the market before acting',
      content: 'Investigate the market and summarize the setup.',
    })

    global.fetch = Object.assign(
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            output: { result: 'Direct request successful' },
          }),
        headers: {
          get: () => 'application/json',
          forEach: () => {},
        },
        clone: function () {
          return { ...this }
        },
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool(
      skillLoaderTool.id,
      {
        ...skillLoaderTool.params,
        skill_id: 'skill-1',
      },
      false,
      createMockExecutionContext()
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      content: 'Investigate the market and summarize the setup.',
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should return a scoped error when selected skill content is missing', async () => {
    const skillLoaderTool = buildLoadSkillTool('tradinggoose_internal_load_skill', [
      {
        id: 'deleted-skill',
        name: 'deleted',
        description: 'Deleted skill',
      },
    ])

    const result = await executeTool(
      skillLoaderTool.id,
      {
        ...skillLoaderTool.params,
        skill_id: 'deleted-skill',
      },
      false,
      createMockExecutionContext()
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('was not found')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should handle non-existent tool', async () => {
    // Create the mock with a matching implementation
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await executeTool('non_existent_tool', {})

    // Expect failure
    expect(result.success).toBe(false)
    expect(result.error).toContain('Tool not found')

    vi.restoreAllMocks()
  })

  it('should handle errors from tools', async () => {
    // Mock a failed response
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 400,
          json: () =>
            Promise.resolve({
              error: 'Bad request',
            }),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool('http_request', {
      url: 'https://api.example.com/data',
      method: 'GET',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.timing).toBeDefined()
  })

  it('should add timing information to results', async () => {
    const result = await executeTool('http_request', {
      url: 'https://api.example.com/data',
    })

    expect(result.timing).toBeDefined()
    expect(result.timing?.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(result.timing?.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(result.timing?.duration).toBeGreaterThanOrEqual(0)
  })
})

describe('Automatic Internal Route Detection', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = mockEnvironmentVariables({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it.each<{
    name: string
    url: ToolConfig['request']['url']
    method: 'GET' | 'POST'
    params: ToolConfig['params']
    input: Record<string, any>
    expectedUrl: string
  }>([
    {
      name: 'static internal',
      url: '/api/test/endpoint',
      method: 'POST',
      params: {},
      input: {},
      expectedUrl: 'http://localhost:3000/api/test/endpoint',
    },
    {
      name: 'static external',
      url: 'https://api.example.com/endpoint',
      method: 'GET',
      params: {},
      input: {},
      expectedUrl: 'https://api.example.com/endpoint',
    },
    {
      name: 'dynamic internal',
      url: (params: Record<string, any>) => `/api/resources/${params.resourceId}?filter=active`,
      method: 'GET',
      params: { resourceId: { type: 'string', required: true } },
      input: { resourceId: '123', _context: { workspaceId: 'workspace-1' } },
      expectedUrl: 'http://localhost:3000/api/resources/123?filter=active&workspaceId=workspace-1',
    },
    {
      name: 'dynamic external',
      url: (params: Record<string, any>) => `https://api.external.com/${params.endpoint}`,
      method: 'GET',
      params: { endpoint: { type: 'string', required: true } },
      input: { endpoint: 'users' },
      expectedUrl: 'https://api.external.com/users',
    },
  ])('dispatches $name routes directly', async ({ url, method, params, input, expectedUrl }) => {
    const internal = expectedUrl.startsWith('http://localhost:3000/')
    const output = { result: 'Route success' }
    const transformResponse = vi.fn().mockResolvedValue({ success: true, output })
    tools.test_route = {
      id: 'test_route',
      name: 'Test route',
      description: '',
      version: '1.0.0',
      params,
      request: { url, method, headers: () => ({ 'Content-Type': 'application/json' }) },
      ...(internal ? { transformResponse } : {}),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(internal ? { success: true, data: 'test' } : { success: true, output })
      )
    )
    try {
      expect(await executeTool('test_route', input)).toMatchObject({ success: true, output })
      expect(fetch).toHaveBeenCalledExactlyOnceWith(expectedUrl, expect.anything())
      expect(transformResponse).toHaveBeenCalledTimes(internal ? 1 : 0)
    } finally {
      Reflect.deleteProperty(tools, 'test_route')
    }
  })
})

describe('Centralized Error Handling', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = mockEnvironmentVariables({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  const testErrorFormat = async (errorResponse: unknown, expectedError: string) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(errorResponse, { status: 400, statusText: 'Bad Request' }))
    )

    const result = await executeTool('function_execute', { code: 'return { result: "test" }' })

    expect(result.success).toBe(false)
    expect(result.error).toBe(expectedError)
  }

  it('should extract GraphQL error format (Linear API)', async () => {
    await testErrorFormat({ errors: [{ message: 'Invalid query field' }] }, 'Invalid query field')
  })

  it('should extract X/Twitter API error format', async () => {
    await testErrorFormat({ errors: [{ detail: 'Rate limit exceeded' }] }, 'Rate limit exceeded')
  })

  it('should extract Hunter API error format', async () => {
    await testErrorFormat({ errors: [{ details: 'Invalid API key' }] }, 'Invalid API key')
  })

  it('should extract direct errors array (string)', async () => {
    await testErrorFormat({ errors: ['Network timeout'] }, 'Network timeout')
  })

  it('should extract direct errors array (object)', async () => {
    await testErrorFormat({ errors: [{ message: 'Validation failed' }] }, 'Validation failed')
  })

  it('should extract OAuth error description', async () => {
    await testErrorFormat({ error_description: 'Invalid grant' }, 'Invalid grant')
  })

  it('should extract SOAP fault error', async () => {
    await testErrorFormat({ fault: { faultstring: 'Server unavailable' } }, 'Server unavailable')
  })

  it('should extract simple SOAP faultstring', async () => {
    await testErrorFormat({ faultstring: 'Authentication failed' }, 'Authentication failed')
  })

  it('should extract Notion/Discord message format', async () => {
    await testErrorFormat({ message: 'Page not found' }, 'Page not found')
  })

  it('should extract Airtable error object format', async () => {
    await testErrorFormat({ error: { message: 'Invalid table ID' } }, 'Invalid table ID')
  })

  it('should extract simple error string format', async () => {
    await testErrorFormat({ error: 'Simple error message' }, 'Simple error message')
  })

  it('should fall back to HTTP status when JSON parsing fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('Invalid JSON response', {
            status: 500,
            statusText: 'Internal Server Error',
          })
      )
    )

    const result = await executeTool('function_execute', { code: 'return { result: "test" }' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Internal Server Error')
  })

  it('should handle complex nested error objects', async () => {
    await testErrorFormat(
      { error: { code: 400, message: 'Complex validation error', details: 'Field X is invalid' } },
      'Complex validation error'
    )
  })

  it('should handle error arrays with multiple entries (take first)', async () => {
    await testErrorFormat(
      { errors: [{ message: 'First error' }, { message: 'Second error' }] },
      'First error'
    )
  })

  it('should stringify complex error objects when no message found', async () => {
    const complexError = { code: 500, type: 'ServerError', context: { requestId: '123' } }
    await testErrorFormat({ error: complexError }, JSON.stringify(complexError))
  })
})

describe('MCP Tool Execution', () => {
  const serverId = '550e8400-e29b-41d4-a716-446655440000'
  const output = { content: [{ type: 'text', text: 'MCP result' }] }
  let cleanupEnvVars: () => void

  beforeEach(() => {
    cleanupEnvVars = mockEnvironmentVariables({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    vi.mocked(generateInternalToken).mockResolvedValue('mock-internal-token')
    vi.stubGlobal('fetch', createMockFetch({ success: true, data: { success: true, output } }))
  })
  afterEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
    cleanupEnvVars()
  })

  it('executes the canonical MCP response with authenticated workflow scope', async () => {
    vi.stubGlobal('window', undefined)
    const result = await executeTool(
      'mcp',
      { serverId, toolName: 'list_files', arguments: { path: '/test' } },
      false,
      createMockExecutionContext({ isDeployedContext: false })
    )
    expect(result).toMatchObject({
      success: true,
      output,
      timing: { duration: expect.any(Number) },
    })
    expect(generateInternalToken).toHaveBeenCalledWith('user-123')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/mcp/tools/execute',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-internal-token',
        },
      })
    )
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
      serverId,
      toolName: 'list_files',
      arguments: { path: '/test' },
      workspaceId: 'workspace-456',
      workflowId: 'test-workflow',
      isDeployedContext: false,
    })
  })

  it('preserves UUID server and hyphenated tool identities through native Agent dispatch', async () => {
    const target = {
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      toolName: 'search-with-hyphens',
    }
    const args = {
      serverId: 'business-server',
      toolName: 'business-tool',
      arguments: 'business input',
      _context: { userId: 'business-user' },
    }
    const id = createMcpToolId(target.serverId, target.toolName)
    const context = createMockExecutionContext()
    const { tools } = createAgentToolSet(
      [
        {
          id,
          mcp: target,
          description: 'Search',
          parameters: {
            type: 'object',
            properties: {
              serverId: { type: 'string' },
              toolName: { type: 'string' },
              arguments: { type: 'string' },
              _context: { type: 'object' },
            },
          },
        },
      ],
      createMinimalWorkflow().blocks[1],
      context,
      new AbortController()
    )
    let step = 0
    const model = new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content:
          step++ === 0
            ? [
                {
                  type: 'tool-call',
                  toolCallId: 'search-call',
                  toolName: id,
                  input: JSON.stringify(args),
                },
              ]
            : [{ type: 'text', text: 'Found it' }],
        finishReason: step === 1 ? 'tool-calls' : 'stop',
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        warnings: [],
      }),
    })
    const result = await new Agent({
      id: 'uuid-mcp',
      name: 'UUID MCP',
      instructions: '',
      model,
      tools,
    }).generate('Search', { maxSteps: 2 })
    expect(result.text).toBe('Found it')
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({
      ...target,
      arguments: args,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
    })
  })

  it('dispatches a direct MCP block with the same UUID target contract', async () => {
    const { McpBlock } = await import('@/blocks/blocks/mcp')
    vi.mocked(getBlock).mockReturnValueOnce(McpBlock)
    const inputs = { server: serverId, tool: 'search-with-hyphens', arguments: { query: 'Goose' } }
    const result = await new GenericBlockHandler().execute(
      {
        id: 'direct-mcp',
        position: { x: 0, y: 0 },
        config: { tool: McpBlock.tools!.config!.tool!(inputs), params: {} },
        metadata: { id: 'mcp', name: 'MCP', description: '', category: 'tools', color: '' },
        inputs: {},
        outputs: {},
        enabled: true,
      },
      inputs,
      createMockExecutionContext()
    )
    expect(result).toEqual(output)
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({
      serverId,
      toolName: inputs.tool,
      arguments: inputs.arguments,
    })
  })

  it('preserves hyphens in canonical MCP tool identities', async () => {
    const result = await executeTool(
      'mcp',
      { serverId, toolName: 'complex-tool-name', arguments: { param: 'value' } },
      false,
      createMockExecutionContext()
    )
    expect(result.success).toBe(true)
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({
      serverId,
      toolName: 'complex-tool-name',
      arguments: { param: 'value' },
    })
  })

  it.each([false, true])(
    'keeps application arguments separate from Studio scope (JSON=%s)',
    async (json) => {
      const args = {
        query: 'search term',
        arguments: 'application input',
        _context: { userId: 'application user' },
        serverId: 'application server',
      }
      const result = await executeTool(
        'mcp',
        { serverId, toolName: 'search', arguments: json ? JSON.stringify(args) : args },
        false,
        createMockExecutionContext()
      )
      expect(result).toMatchObject({ success: true, output })
      expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({
        arguments: args,
        serverId,
        workspaceId: 'workspace-456',
        workflowId: 'test-workflow',
      })
    }
  )

  it('forwards native cancellation to the shared MCP request', async () => {
    const controller = new AbortController()
    let observedSignal: AbortSignal | undefined
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          observedSignal = options!.signal as AbortSignal
          observedSignal.addEventListener('abort', () => reject(observedSignal!.reason), {
            once: true,
          })
          controller.abort(new Error('MCP cancelled'))
        })
    )
    const result = await executeTool(
      'mcp',
      { serverId, toolName: 'search', arguments: {} },
      false,
      createMockExecutionContext(),
      { signal: controller.signal }
    )
    expect(observedSignal).toBe(controller.signal)
    expect(result).toMatchObject({ success: false, error: 'MCP cancelled' })
  })

  it('rejects revoked workspace access before an MCP request', async () => {
    permissionMocks.checkWorkspaceAccess.mockResolvedValueOnce({
      hasAccess: false,
      canWrite: false,
    })
    const result = await executeTool(
      'mcp',
      { serverId, toolName: 'search', arguments: {} },
      false,
      createMockExecutionContext()
    )
    expect(result.error).toContain('requires read access')
    expect(result.success).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['{', '[]', 'null', '"scalar"'])(
    'rejects invalid MCP arguments %s before execution',
    async (args) => {
      const result = await executeTool(
        'mcp',
        { serverId, toolName: 'search', arguments: args },
        false,
        createMockExecutionContext()
      )
      expect(result.success).toBe(false)
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it.each([{ output }, { data: output }, { data: null }])(
    'rejects noncanonical successful response %j',
    async (response) => {
      vi.mocked(fetch).mockResolvedValue(Response.json({ success: true, ...response }))
      const result = await executeTool(
        'mcp',
        { serverId, toolName: 'search', arguments: {} },
        false,
        createMockExecutionContext()
      )
      expect(result).toMatchObject({ success: false, error: 'Invalid MCP execution response' })
    }
  )

  it('requires workspace execution context', async () => {
    const result = await executeTool('mcp', { serverId, toolName: 'test_tool', arguments: {} })
    expect(result.success).toBe(false)
    expect(result.error).toContain('requires workspace execution context')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails before HTTP execution when internal authentication cannot be generated', async () => {
    vi.stubGlobal('window', undefined)
    vi.mocked(generateInternalToken).mockRejectedValueOnce(
      new Error('Internal authentication failed')
    )
    const result = await executeTool(
      'mcp',
      { serverId, toolName: 'search', arguments: {} },
      false,
      createMockExecutionContext()
    )
    expect(result).toMatchObject({ success: false, error: 'Internal authentication failed' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['http', 'network'])('returns the MCP %s error with timing', async (kind) => {
    if (kind === 'http')
      vi.mocked(fetch).mockResolvedValue(
        Response.json({ success: false, error: 'Tool not found on server' }, { status: 404 })
      )
    else vi.mocked(fetch).mockRejectedValue(new Error('Network error'))
    const result = await executeTool(
      'mcp',
      { serverId, toolName: 'search', arguments: {} },
      false,
      createMockExecutionContext()
    )
    expect(result).toMatchObject({
      success: false,
      error: kind === 'http' ? 'Tool not found on server' : 'Network error',
      timing: { duration: expect.any(Number) },
    })
  })

  it.each(['vision_tool', 'llm_chat', 'guardrails_validate', 'openai_embeddings'])(
    'preserves failed native accounting through HTTP execution for %s',
    async (toolId) => {
      const accounting = {
        model: 'openai/gpt-4o',
        tokens: { total: 20 },
        cost: { status: 'partial', availableTotal: 0.002, estimated: true },
      }
      vi.mocked(fetch).mockResolvedValue(
        Response.json(
          { success: false, error: 'generation aborted', ...accounting },
          { status: 500 }
        )
      )
      const result = await executeTool(
        toolId,
        {
          model: 'openai/gpt-4o',
          context: 'hello',
          imageUrl: 'https://example.com/image.png',
          input: 'hello',
          validationType: 'hallucination',
          apiKey: 'request-key',
        },
        false,
        createMockExecutionContext()
      )
      expect(result.success).toBe(false)
      expect(result.output).toMatchObject(accounting)
      expect(result.error).toContain('generation aborted')
    }
  )
})
