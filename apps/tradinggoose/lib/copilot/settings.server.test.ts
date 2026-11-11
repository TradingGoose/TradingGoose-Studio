/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type CopilotSettings, DEFAULT_COPILOT_SETTINGS } from './settings'

const { mockGetResolvedSystemSettings, mockResolveSystemServiceConfig } = vi.hoisted(() => ({
  mockGetResolvedSystemSettings: vi.fn(),
  mockResolveSystemServiceConfig: vi.fn(),
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
      models: ['openai/new-model', 'anthropic/other-model'],
      defaultModel: 'openai/new-model',
    })
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
