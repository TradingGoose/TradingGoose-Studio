import { describe, expect, it, vi } from 'vitest'

vi.mock('@mastra/core/llm', () => ({
  GatewayRegistry: {
    getInstance: () => ({
      getProviders: () => ({
        openai: { name: 'OpenAI' },
        'azure-openai': { name: 'Azure OpenAI' },
        vendor: { name: 'Vendor', url: 'https://private.invalid', apiKey: 'private-secret' },
      }),
    }),
  },
}))
vi.mock('@/lib/mastra/registry', () => {
  throw new Error('The service catalog must not load the managed model registry')
})

import {
  getSystemServiceDefinition,
  getSystemServiceDefinitions,
  isSystemServiceCredentialKey,
  isSystemServiceSettingKey,
} from './catalog'

describe('managed native model service definitions', () => {
  it.each([
    {
      id: 'azure_openai',
      credentials: ['apiKey'],
      settings: ['resourceName', 'apiVersion', 'deployments'],
    },
    { id: 'ollama', credentials: ['apiKey'], settings: ['baseUrl', 'models'] },
    { id: 'vllm', credentials: ['apiKey'], settings: ['baseUrl', 'models'] },
    { id: 'mastra_model_providers', credentials: ['apiKeys'], settings: ['providers'] },
  ])('keeps $id credentials separate from connection settings', ({ id, credentials, settings }) => {
    const definition = getSystemServiceDefinition(id)!
    expect(definition.credentialFields.map(({ key }) => key)).toEqual(credentials)
    expect(definition.settingFields.map(({ key }) => key)).toEqual(settings)
    for (const key of credentials) {
      expect(isSystemServiceCredentialKey(id, key)).toBe(true)
      expect(isSystemServiceSettingKey(id, key)).toBe(false)
    }
    for (const key of settings) {
      expect(isSystemServiceSettingKey(id, key)).toBe(true)
      expect(isSystemServiceCredentialKey(id, key)).toBe(false)
    }
  })

  it('exposes full native endpoint settings without legacy aliases or requiring local bearer keys', () => {
    expect(getSystemServiceDefinition('ollama')?.settingFields).toContainEqual(
      expect.objectContaining({ key: 'baseUrl', defaultValue: 'http://localhost:11434/v1' })
    )
    for (const id of ['ollama', 'vllm'])
      expect(getSystemServiceDefinition(id)?.credentialFields).toEqual([
        expect.objectContaining({ key: 'apiKey', required: false }),
      ])
    expect(isSystemServiceSettingKey('azure_openai', 'endpoint')).toBe(false)
    expect(isSystemServiceSettingKey('azure_openai', 'embeddingModel')).toBe(false)
    expect(isSystemServiceSettingKey('mastra_model_providers', 'apiKeyEnvVar')).toBe(false)
  })

  it('uses native provider metadata without reading managed connections or copying secrets', () => {
    const definitions = getSystemServiceDefinitions()
    expect(definitions.filter(({ id }) => id === 'openai')).toHaveLength(1)
    expect(getSystemServiceDefinition('openai')?.credentialFields[0].key).toBe('defaultApiKey')
    expect(getSystemServiceDefinition('vendor')).toMatchObject({
      displayName: 'Vendor',
      credentialFields: [{ key: 'apiKey' }],
      settingFields: [],
    })
    expect(getSystemServiceDefinition('azure-openai')).toBeNull()
    expect(JSON.stringify(definitions)).not.toMatch(/private\.invalid|private-secret/)
  })
})
