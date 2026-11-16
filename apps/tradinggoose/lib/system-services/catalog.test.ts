import { describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ catalogRead: vi.fn() }))

vi.mock('@mastra/core/llm', () => ({
  GatewayRegistry: {
    getInstance: () => ({
      getProviders: () => {
        native.catalogRead()
        return {
          openai: { name: 'OpenAI', gateway: 'models.dev' },
          vendor: {
            name: 'Vendor',
            gateway: 'models.dev',
            url: 'https://private.invalid',
            apiKey: 'private-secret',
          },
          netlify: { name: 'Netlify', gateway: 'netlify' },
          configured: { name: 'Configured', gateway: 'models.dev', url: `https://\${HOST}/v1` },
        }
      },
    }),
  },
}))
vi.mock('@/lib/mastra/registry', () => {
  throw new Error('The service catalog must not load the managed model registry')
})

import {
  getSystemServiceDefinition,
  getSystemServiceDefinitions,
  SYSTEM_SERVICE_DEFINITIONS,
} from './catalog'

describe('native model service definitions', () => {
  it('resolves built-in services without loading the model provider catalog', async () => {
    native.catalogRead.mockClear()
    for (const definition of SYSTEM_SERVICE_DEFINITIONS)
      expect(await getSystemServiceDefinition(definition.id)).toBe(definition)
    expect(native.catalogRead).not.toHaveBeenCalled()
  })
  it('uses native provider metadata without reading managed connections or copying secrets', async () => {
    const definitions = await getSystemServiceDefinitions()
    expect(definitions.filter(({ id }) => id === 'openai')).toHaveLength(1)
    expect((await getSystemServiceDefinition('openai'))?.credentialFields[0].key).toBe(
      'defaultApiKey'
    )
    expect(await getSystemServiceDefinition('vendor')).toMatchObject({
      displayName: 'Vendor',
      credentialFields: [{ key: 'apiKey' }],
      settingFields: [],
    })
    for (const id of [
      'azure_openai',
      'ollama',
      'vllm',
      'mastra_model_providers',
      'netlify',
      'configured',
    ])
      expect(await getSystemServiceDefinition(id)).toBeNull()
    expect(JSON.stringify(definitions)).not.toMatch(/private\.invalid|private-secret/)
  })
})
