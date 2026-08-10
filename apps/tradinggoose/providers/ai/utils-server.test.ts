import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getApiKey } from '@/providers/ai/utils-server'

const mockResolveOpenAIServiceConfig = vi.fn()
const mockResolveAnthropicServiceConfig = vi.fn()
const mockResolveDeepseekServiceConfig = vi.fn()
const mockResolveOpenRouterServiceConfig = vi.fn()
const mockResolveNvidiaServiceConfig = vi.fn()

vi.mock('@/lib/system-services/runtime', () => ({
  resolveOpenAIServiceConfig: () => mockResolveOpenAIServiceConfig(),
  resolveAnthropicServiceConfig: () => mockResolveAnthropicServiceConfig(),
  resolveDeepseekServiceConfig: () => mockResolveDeepseekServiceConfig(),
  resolveOpenRouterServiceConfig: () => mockResolveOpenRouterServiceConfig(),
  resolveNvidiaServiceConfig: () => mockResolveNvidiaServiceConfig(),
}))

describe('getApiKey system service fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveOpenAIServiceConfig.mockResolvedValue({ rotationKeys: [], defaultApiKey: null })
    mockResolveAnthropicServiceConfig.mockResolvedValue({ rotationKeys: [] })
    mockResolveDeepseekServiceConfig.mockResolvedValue({
      apiKey: 'system-deepseek-key',
      rotationKeys: [],
    })
    mockResolveOpenRouterServiceConfig.mockResolvedValue({
      apiKey: 'system-openrouter-key',
      rotationKeys: [],
    })
    mockResolveNvidiaServiceConfig.mockResolvedValue({
      apiKey: 'system-nvidia-key',
      rotationKeys: [],
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })
  })

  it.each([
    ['deepseek', 'deepseek-v4-flash', 'system-deepseek-key'],
    ['openrouter', 'openrouter/meta-llama/llama-3.3-70b-instruct', 'system-openrouter-key'],
    ['nvidia', 'nvidia/meta/llama-3.3-70b-instruct', 'system-nvidia-key'],
  ])(
    'uses the admin-configured key for %s when no key is supplied',
    async (provider, model, expected) => {
      await expect(getApiKey(provider, model)).resolves.toBe(expected)
    }
  )

  it('prefers a request-supplied key over the admin-configured one', async () => {
    await expect(getApiKey('openrouter', 'openrouter/some-model', 'user-key')).resolves.toBe(
      'user-key'
    )
    expect(mockResolveOpenRouterServiceConfig).not.toHaveBeenCalled()
  })

  it('throws when the admin-configured key is empty', async () => {
    mockResolveNvidiaServiceConfig.mockResolvedValue({
      apiKey: null,
      rotationKeys: [],
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })

    await expect(getApiKey('nvidia', 'nvidia/some-model')).rejects.toThrow(
      'API key is required for nvidia nvidia/some-model'
    )
  })

  it('throws when resolving the admin-configured key fails', async () => {
    mockResolveDeepseekServiceConfig.mockRejectedValue(new Error('db unavailable'))

    await expect(getApiKey('deepseek', 'deepseek-v4-flash')).rejects.toThrow(
      'API key is required for deepseek deepseek-v4-flash'
    )
  })

  it('does not consult system services for providers without a central key', async () => {
    await expect(getApiKey('xai', 'grok-4-latest')).rejects.toThrow(
      'API key is required for xai grok-4-latest'
    )
    expect(mockResolveDeepseekServiceConfig).not.toHaveBeenCalled()
    expect(mockResolveOpenRouterServiceConfig).not.toHaveBeenCalled()
    expect(mockResolveNvidiaServiceConfig).not.toHaveBeenCalled()
  })
})

describe('getApiKey rotation slots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockResolveOpenAIServiceConfig.mockResolvedValue({ rotationKeys: [], defaultApiKey: null })
    mockResolveAnthropicServiceConfig.mockResolvedValue({ rotationKeys: [] })
    mockResolveDeepseekServiceConfig.mockResolvedValue({ apiKey: null, rotationKeys: [] })
    mockResolveOpenRouterServiceConfig.mockResolvedValue({ apiKey: null, rotationKeys: [] })
    mockResolveNvidiaServiceConfig.mockResolvedValue({
      apiKey: null,
      rotationKeys: [],
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rotates the deepseek key by minute across the configured slots', async () => {
    mockResolveDeepseekServiceConfig.mockResolvedValue({
      apiKey: null,
      rotationKeys: ['slot-1', 'slot-2', 'slot-3'],
    })

    vi.setSystemTime(new Date('2026-08-10T10:00:00Z'))
    await expect(getApiKey('deepseek', 'deepseek-v4-flash')).resolves.toBe('slot-1')

    vi.setSystemTime(new Date('2026-08-10T10:01:00Z'))
    await expect(getApiKey('deepseek', 'deepseek-v4-flash')).resolves.toBe('slot-2')

    vi.setSystemTime(new Date('2026-08-10T10:02:00Z'))
    await expect(getApiKey('deepseek', 'deepseek-v4-flash')).resolves.toBe('slot-3')

    vi.setSystemTime(new Date('2026-08-10T10:03:00Z'))
    await expect(getApiKey('deepseek', 'deepseek-v4-flash')).resolves.toBe('slot-1')
  })

  it('skips empty slots so a partially filled rotation still works', async () => {
    mockResolveNvidiaServiceConfig.mockResolvedValue({
      apiKey: null,
      rotationKeys: ['only-slot-2'],
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })

    vi.setSystemTime(new Date('2026-08-10T10:07:00Z'))
    await expect(getApiKey('nvidia', 'nvidia/some-model')).resolves.toBe('only-slot-2')
  })

  it('prefers rotation slots over the single API key field', async () => {
    mockResolveOpenRouterServiceConfig.mockResolvedValue({
      apiKey: 'single-key',
      rotationKeys: ['rotating-key'],
    })

    vi.setSystemTime(new Date('2026-08-10T10:00:00Z'))
    await expect(getApiKey('openrouter', 'openrouter/some-model')).resolves.toBe('rotating-key')
  })

  it.each([
    ['openai', 'gpt-4o', mockResolveOpenAIServiceConfig],
    ['anthropic', 'claude-sonnet-4-5', mockResolveAnthropicServiceConfig],
  ])('rotates %s keys without requiring a hosted deployment', async (provider, model, resolver) => {
    resolver.mockResolvedValue({ rotationKeys: ['a', 'b'], defaultApiKey: null })

    vi.setSystemTime(new Date('2026-08-10T10:00:00Z'))
    await expect(getApiKey(provider, model)).resolves.toBe('a')

    vi.setSystemTime(new Date('2026-08-10T10:01:00Z'))
    await expect(getApiKey(provider, model)).resolves.toBe('b')
  })

  it('leaves the OpenAI Default API Key reserved for embeddings', async () => {
    mockResolveOpenAIServiceConfig.mockResolvedValue({
      rotationKeys: [],
      defaultApiKey: 'embeddings-only-key',
    })

    await expect(getApiKey('openai', 'gpt-4o')).rejects.toThrow(
      'API key is required for openai gpt-4o'
    )
  })
})
