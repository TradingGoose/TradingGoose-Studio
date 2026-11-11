/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CopilotSettings, DEFAULT_COPILOT_SETTINGS } from './settings'

const { mockGetResolvedSystemSettings, mockResolveSystemServiceConfig } = vi.hoisted(() => ({
  mockGetResolvedSystemSettings: vi.fn(),
  mockResolveSystemServiceConfig: vi.fn(),
}))

vi.mock('@/lib/mastra/registry', () => ({
  getModelProviders: () => [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'new-native-provider', name: 'New Native Provider' },
  ],
}))
vi.mock('@opencode-ai/models/snapshot', () => ({
  providers: {
    openrouter: {
      models: { 'vendor/known-model': { canonical_model_id: 'vendor/family/known-model' } },
    },
  },
}))

vi.mock('@/lib/system-settings/service', () => ({
  getResolvedSystemSettings: mockGetResolvedSystemSettings,
}))
vi.mock('@/lib/system-services/service', () => ({
  resolveSystemServiceConfig: mockResolveSystemServiceConfig,
}))

import { getPublicCopilotModels, resolveCopilotModel } from './settings.server'

const configured: CopilotSettings = {
  models: [
    { provider: 'openai', model: 'new-model' },
    { provider: 'anthropic', model: 'other-model' },
  ],
  defaultModel: 'openai/new-model',
}

describe('server Copilot settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetResolvedSystemSettings.mockResolvedValue({ copilot: configured })
    mockResolveSystemServiceConfig.mockResolvedValue({ defaultApiKey: 'openai-key' })
  })

  it('resolves the configured default with the existing OpenAI credential', async () => {
    await expect(resolveCopilotModel()).resolves.toEqual({
      model: 'openai/new-model',
      apiKey: 'openai-key',
    })
    expect(mockResolveSystemServiceConfig).toHaveBeenCalledWith('openai')
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
      defaultModel: 'openai/new-model',
    })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it('uses one native provider credential definition for an exact future model', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: {
        models: [{ provider: 'new-native-provider', model: 'namespace/future-model' }],
        defaultModel: 'new-native-provider/namespace/future-model',
      },
    })
    mockResolveSystemServiceConfig.mockResolvedValue({ apiKey: ' native-key ' })
    await expect(resolveCopilotModel()).resolves.toEqual({
      model: 'new-native-provider/namespace/future-model',
      apiKey: 'native-key',
    })
    expect(mockResolveSystemServiceConfig).toHaveBeenCalledExactlyOnceWith('new-native-provider')
  })

  it('projects canonical model identities and preserves future model namespaces without gateway labels', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: {
        models: [
          { provider: 'openrouter', model: 'vendor/known-model' },
          { provider: 'openrouter', model: 'vendor/family/future-model' },
          { provider: 'openai', model: 'future-model' },
        ],
        defaultModel: 'openrouter/vendor/known-model',
      },
    })
    expect(await getPublicCopilotModels()).toEqual({
      models: [
        { id: 'openrouter/vendor/known-model', label: 'vendor/family/known-model' },
        { id: 'openrouter/vendor/family/future-model', label: 'vendor/family/future-model' },
        { id: 'openai/future-model', label: 'openai/future-model' },
      ],
      defaultModel: 'openrouter/vendor/known-model',
    })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it('keeps gateway configuration out of user-facing credential errors', async () => {
    mockGetResolvedSystemSettings.mockResolvedValue({
      copilot: {
        models: [{ provider: 'openrouter', model: 'vendor/known-model' }],
        defaultModel: 'openrouter/vendor/known-model',
      },
    })
    mockResolveSystemServiceConfig.mockResolvedValue({})
    await expect(resolveCopilotModel()).rejects.toMatchObject({
      status: 409,
      message: 'The system API key for the selected Copilot model is not configured',
    })
  })

  it.each(['unknown-provider', 'local_execution'])(
    'refuses unavailable credential metadata for %s before key resolution',
    async (provider) => {
      mockGetResolvedSystemSettings.mockResolvedValue({
        copilot: {
          models: [{ provider, model: 'future-model' }],
          defaultModel: `${provider}/future-model`,
        },
      })
      await expect(resolveCopilotModel()).rejects.toMatchObject({ status: 409 })
      expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
    }
  )

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
        defaultModel: 'anthropic/other-model',
      },
    })
    await expect(resolveCopilotModel('openai/new-model')).rejects.toMatchObject({ status: 422 })
    expect(mockResolveSystemServiceConfig).not.toHaveBeenCalled()
  })

  it.each([{}, { defaultApiKey: '' }, { defaultApiKey: '   ' }])(
    'rejects missing or undecryptable admin credentials even when environment keys exist',
    async (credentials) => {
      vi.stubEnv('OPENAI_API_KEY', 'environment-key')
      mockResolveSystemServiceConfig.mockResolvedValue(credentials)
      try {
        await expect(resolveCopilotModel()).rejects.toMatchObject({ status: 409 })
      } finally {
        vi.unstubAllEnvs()
      }
    }
  )
})
