import { describe, expect, it, vi } from 'vitest'

vi.mock('@mastra/core/llm', () => ({
  GatewayRegistry: {
    getInstance: () => ({
      getProviders: () => ({
        openai: { name: 'OpenAI' },
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

describe('native model service definitions', () => {
  it('uses native provider metadata without reading managed connections or copying secrets', () => {
    const definitions = getSystemServiceDefinitions()
    expect(definitions.filter(({ id }) => id === 'openai')).toHaveLength(1)
    expect(getSystemServiceDefinition('openai')?.credentialFields[0].key).toBe('defaultApiKey')
    expect(getSystemServiceDefinition('vendor')).toMatchObject({
      displayName: 'Vendor',
      credentialFields: [{ key: 'apiKey' }],
      settingFields: [],
    })
    expect(isSystemServiceCredentialKey('vendor', 'apiKey')).toBe(true)
    expect(isSystemServiceSettingKey('vendor', 'baseUrl')).toBe(false)
    for (const id of ['azure_openai', 'ollama', 'vllm', 'mastra_model_providers'])
      expect(getSystemServiceDefinition(id)).toBeNull()
    expect(JSON.stringify(definitions)).not.toMatch(/private\.invalid|private-secret/)
  })
})
