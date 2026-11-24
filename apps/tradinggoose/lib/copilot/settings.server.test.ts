/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CopilotSettings, DEFAULT_COPILOT_SETTINGS } from './settings'

const { mockGetResolvedSystemSettings, mockResolveSystemServiceConfig } = vi.hoisted(() => ({
  mockGetResolvedSystemSettings: vi.fn(),
  mockResolveSystemServiceConfig: vi.fn(),
}))

vi.mock('@mastra/core/llm', async (importOriginal) => {
  const native = await importOriginal<typeof import('@mastra/core/llm')>()
  return {
    ...native,
    GatewayRegistry: {
      getInstance: () => ({
        getProviders: () => ({
          ...native.GatewayRegistry.getInstance().getProviders(),
          'new-native-provider': { name: 'New Native Provider', models: [], gateway: 'models.dev' },
        }),
      }),
    },
  }
})

vi.mock('@/lib/system-settings/service', () => ({
  getCopilotSettings: async () => (await mockGetResolvedSystemSettings()).copilot,
}))
vi.mock('@/lib/system-services/service', () => ({
  resolveSystemServiceConfig: mockResolveSystemServiceConfig,
}))

import { getModelReasoningOptions } from '@mastra/core/llm'
import { getPublicCopilotModels, resolveCopilotModel } from './settings.server'

const configured: CopilotSettings = {
  models: [
    { provider: 'openai', model: 'new-model' },
    { provider: 'anthropic', model: 'other-model' },
  ],
}

describe('server Copilot settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetResolvedSystemSettings.mockResolvedValue({ copilot: configured })
    mockResolveSystemServiceConfig.mockResolvedValue({ defaultApiKey: 'openai-key' })
  })

  it('resolves the first configured model with its existing credential', async () => {
    await expect(resolveCopilotModel()).resolves.toEqual({
      model: 'openai/new-model',
      apiKey: 'openai-key',
    })
    expect(mockResolveSystemServiceConfig).toHaveBeenCalledWith('openai')
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: { models: [...configured.models].reverse() },
    })
    mockResolveSystemServiceConfig.mockResolvedValue({ apiKey: 'anthropic-key' })
    await expect(resolveCopilotModel()).resolves.toEqual({
      model: 'anthropic/other-model',
      apiKey: 'anthropic-key',
    })
    expect(mockResolveSystemServiceConfig).toHaveBeenLastCalledWith('anthropic')
  })

  it('resolves the selected provider key and reads fresh keys for subsequent requests', async () => {
    mockResolveSystemServiceConfig
      .mockResolvedValueOnce({ apiKey: 'first-key' })
      .mockResolvedValueOnce({ apiKey: 'rotated-key' })

    await expect(resolveCopilotModel('anthropic/other-model')).resolves.toEqual({
      model: 'anthropic/other-model',
      apiKey: 'first-key',
    })
    await expect(resolveCopilotModel('anthropic/other-model')).resolves.toEqual({
      model: 'anthropic/other-model',
      apiKey: 'rotated-key',
    })
    expect(mockResolveSystemServiceConfig).toHaveBeenNthCalledWith(2, 'anthropic')
    expect(mockGetResolvedSystemSettings).toHaveBeenCalledTimes(2)
  })

  it('projects saved metadata without looking up or filtering on credentials', async () => {
    await expect(getPublicCopilotModels()).resolves.toEqual({
      models: [
        { id: 'openai/new-model', label: 'openai/new-model' },
        { id: 'anthropic/other-model', label: 'anthropic/other-model' },
      ],
    })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it('uses one native provider credential definition for an exact future model', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: {
        models: [{ provider: 'new-native-provider', model: 'namespace/future-model' }],
      },
    })
    mockResolveSystemServiceConfig.mockResolvedValue({ apiKey: 'native-key' })
    await expect(resolveCopilotModel()).resolves.toEqual({
      model: 'new-native-provider/namespace/future-model',
      apiKey: 'native-key',
    })
    expect(mockResolveSystemServiceConfig).toHaveBeenCalledExactlyOnceWith('new-native-provider')
  })

  it.each([
    ['unknown-provider', 'future-model'],
    ['local_execution', 'future-model'],
    ['netlify', 'openai/gpt-4.1'],
    ['netlify', 'openai/gpt-image-1.5'],
    ['databricks', 'databricks-meta-llama-3-3-70b-instruct'],
    ['openai', 'gpt-image-1.5'],
    ['google', 'gemini-embedding-2'],
    ['google', 'lyria-3-clip-preview'],
    ['google', 'lyria-3-pro-preview'],
    ['tinfoil', 'nomic-embed-text'],
    ['xai', 'grok-4.20-multi-agent-0309'],
    ['perplexity', 'sonar-deep-research'],
  ])(
    'rejects the unsupported model %s/%s before resolving credentials',
    async (provider, model) => {
      mockGetResolvedSystemSettings.mockResolvedValue({
        copilot: { models: [{ provider, model }] },
      })
      mockResolveSystemServiceConfig.mockResolvedValue({ defaultApiKey: 'key', apiKey: 'key' })
      await expect(resolveCopilotModel()).rejects.toMatchObject({ status: 422 })
      expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
    }
  )

  it('preserves model order while filtering incompatible Copilot models', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: {
        models: [
          { provider: 'netlify', model: 'openai/gpt-4.1' },
          { provider: 'netlify', model: 'openai/gpt-image-1.5' },
          { provider: 'databricks', model: 'databricks-meta-llama-3-3-70b-instruct' },
          { provider: 'openai', model: 'gpt-image-1.5' },
          { provider: 'google', model: 'gemini-embedding-2' },
          { provider: 'google', model: 'lyria-3-clip-preview' },
          { provider: 'openai', model: 'gpt-4.1' },
          { provider: 'google', model: 'lyria-3-pro-preview' },
          { provider: 'tinfoil', model: 'nomic-embed-text' },
          { provider: 'xai', model: 'grok-4.20-multi-agent-0309' },
          { provider: 'perplexity', model: 'sonar-deep-research' },
          { provider: 'new-native-provider', model: 'namespace/future-model' },
        ],
      },
    })
    expect(await getPublicCopilotModels()).toEqual({
      models: [
        { id: 'openai/gpt-4.1', label: 'openai/gpt-4.1', reasoningOptions: [] },
        { id: 'new-native-provider/namespace/future-model', label: 'namespace/future-model' },
      ],
    })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it('projects canonical model identities and preserves future model namespaces without gateway labels', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: {
        models: [
          { provider: 'openrouter', model: 'amazon/nova-premier-v1' },
          { provider: 'openrouter', model: 'vendor/family/future-model' },
          { provider: 'openai', model: 'future-model' },
        ],
      },
    })
    expect(await getPublicCopilotModels()).toEqual({
      models: [
        {
          id: 'openrouter/amazon/nova-premier-v1',
          label: 'amazon/nova-premier',
          reasoningOptions: [],
        },
        { id: 'openrouter/vendor/family/future-model', label: 'vendor/family/future-model' },
        { id: 'openai/future-model', label: 'openai/future-model' },
      ],
    })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it('keeps gateway configuration out of user-facing credential errors', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: {
        models: [{ provider: 'openrouter', model: 'amazon/nova-premier-v1' }],
      },
    })
    mockResolveSystemServiceConfig.mockResolvedValue({})
    await expect(resolveCopilotModel()).rejects.toMatchObject({
      status: 409,
      message: 'The system connection for the selected Copilot model is not configured',
    })
  })

  it('projects native reasoning controls without changing provider option names or model order', async () => {
    const models = [
      { provider: 'openai', model: 'gpt-5.4' },
      { provider: 'google', model: 'gemini-2.5-pro' },
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
    ]
    mockGetResolvedSystemSettings.mockResolvedValue({ copilot: { models } })
    const result = await getPublicCopilotModels()
    expect(result.models.map(({ id }) => id)).toEqual(
      models.map(({ provider, model }) => `${provider}/${model}`)
    )
    for (const model of result.models) {
      const native = getModelReasoningOptions(model.id)
      expect(model.reasoningOptions).toEqual(native)
    }
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it('checks selections against the authorized model before credential lookup', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: { models: [{ provider: 'openai', model: 'gpt-5' }] },
    })
    await expect(
      resolveCopilotModel('openai/gpt-5', { type: 'toggle', value: false })
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      resolveCopilotModel('openai/stale', { type: 'effort', value: 'low' })
    ).rejects.toMatchObject({ status: 422 })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })
  it('reports an unconfigured Copilot with no built-in fallback', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({ copilot: DEFAULT_COPILOT_SETTINGS })

    await expect(resolveCopilotModel()).rejects.toMatchObject({ status: 409 })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it('rejects arbitrary and removed selections before resolving any provider key', async () => {
    await expect(resolveCopilotModel('openai/unconfigured-model')).rejects.toMatchObject({
      status: 422,
    })
    mockGetResolvedSystemSettings.mockResolvedValueOnce({
      copilot: {
        models: [{ provider: 'anthropic', model: 'other-model' }],
      },
    })
    await expect(resolveCopilotModel('openai/new-model')).rejects.toMatchObject({ status: 422 })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it('rejects unavailable admin credentials even when environment keys exist', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'environment-key')
    mockResolveSystemServiceConfig.mockResolvedValue({})
    try {
      await expect(resolveCopilotModel()).rejects.toMatchObject({ status: 409 })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
