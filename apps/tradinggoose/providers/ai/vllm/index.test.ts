/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateCompletion,
  mockFetch,
  mockOpenAI,
  mockResolveVllmServiceConfig,
  mockSetModels,
} = vi.hoisted(() => {
  const createCompletion = vi.fn()
  const setModels = vi.fn()
  const openAI = vi.fn().mockImplementation((config: Record<string, unknown>) => ({
    config,
    chat: {
      completions: {
        create: createCompletion,
      },
    },
  }))

  return {
    mockCreateCompletion: createCompletion,
    mockFetch: vi.fn(),
    mockOpenAI: openAI,
    mockResolveVllmServiceConfig: vi.fn(),
    mockSetModels: setModels,
  }
})

vi.mock('@/lib/system-services/runtime', () => ({
  resolveVllmServiceConfig: (...args: unknown[]) => mockResolveVllmServiceConfig(...args),
}))

vi.mock('openai', () => ({
  default: mockOpenAI,
}))

vi.mock('@/providers/ai/error', () => ({
  toError: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
}))

vi.mock('@/providers/ai/constants', () => ({
  MAX_TOOL_ITERATIONS: 4,
}))

vi.mock('@/providers/ai/models', () => ({
  getProviderDefaultModel: vi.fn(() => 'vllm/default'),
  getProviderModels: vi.fn(() => ['vllm/default']),
}))

vi.mock('@/providers/ai/utils', () => ({
  calculateCost: vi.fn(() => ({ input: 0, output: 0, total: 0 })),
  prepareToolExecution: vi.fn(),
  prepareToolsWithUsageControl: vi.fn(() => ({
    forcedTools: [],
    toolChoice: 'auto',
    tools: [],
  })),
  sumToolCosts: vi.fn(() => 0),
  trackForcedToolUsage: vi.fn(() => ({
    hasUsedForcedTool: false,
    usedForcedTools: [],
  })),
}))

vi.mock('@/providers/ai/vllm/utils', () => ({
  createReadableStreamFromVLLMStream: vi.fn(),
}))

vi.mock('@/stores/providers/store', () => ({
  useProvidersStore: {
    getState: () => ({
      setModels: mockSetModels,
    }),
  },
}))

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('vLLM provider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('initializes models from the vLLM system service configuration', async () => {
    mockResolveVllmServiceConfig.mockResolvedValue({
      apiKey: 'svc-vllm-key',
      baseUrl: 'http://vllm.internal/',
    })
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'foo' }, { id: 'bar' }],
      }),
    })

    const { vllmProvider } = await import('./index')
    await vllmProvider.initialize?.()

    expect(mockFetch).toHaveBeenCalledWith('http://vllm.internal/v1/models', {
      headers: {
        Authorization: 'Bearer svc-vllm-key',
        'Content-Type': 'application/json',
      },
    })
    expect(mockSetModels).toHaveBeenCalledWith('vllm', ['vllm/foo', 'vllm/bar'])
  })

  it('uses the vLLM system service defaults when executing a request', async () => {
    mockResolveVllmServiceConfig.mockResolvedValue({
      apiKey: 'svc-vllm-key',
      baseUrl: 'http://vllm.internal/',
    })
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'hello from vllm',
          },
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
      },
    })

    const { vllmProvider } = await import('./index')
    const response = await vllmProvider.executeRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'vllm/foo',
    } as any)

    expect(mockOpenAI).toHaveBeenCalledWith({
      apiKey: 'svc-vllm-key',
      baseURL: 'http://vllm.internal/v1',
    })
    expect(mockCreateCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'foo',
      }),
      undefined
    )
    expect(response).toMatchObject({
      content: 'hello from vllm',
      model: 'vllm/foo',
      tokens: {
        input: 11,
        output: 7,
        total: 18,
      },
    })
  })
})
