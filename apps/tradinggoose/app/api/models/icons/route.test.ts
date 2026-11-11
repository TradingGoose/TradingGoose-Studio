/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderLogoCatalogEntry } from '@/lib/ui/provider-logos'

const m = vi.hoisted(() => ({ fetch: vi.fn(), providers: vi.fn() }))
vi.mock('@mastra/core/llm', () => ({
  GatewayRegistry: { getInstance: () => ({ getProviders: m.providers }) },
}))

import { GET } from './route'

const catalog: ProviderLogoCatalogEntry[] = [
  {
    id: 'OpenAI',
    title: 'OpenAI',
    fullTitle: 'OpenAI',
    desc: 'https://openai.com',
    param: { hasColor: false },
  },
  {
    id: 'DeepSeek',
    title: 'DeepSeek',
    fullTitle: 'DeepSeek',
    desc: 'https://deepseek.com',
    param: { hasColor: true },
  },
  {
    id: 'ElevenLabs',
    title: 'ElevenLabs',
    fullTitle: 'ElevenLabs',
    desc: 'https://elevenlabs.io',
    param: { hasColor: false },
  },
]
const svg = (file: string) =>
  `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/${file}.svg`
const coloredLogo = {
  src: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-webp@2.6.0/light/deepseek-color.webp',
  darkSrc: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-webp@2.6.0/dark/deepseek-color.webp',
  monochrome: false,
}

beforeEach(() => {
  vi.stubGlobal('fetch', m.fetch)
  m.fetch.mockReset().mockResolvedValue(Response.json(catalog))
  m.providers.mockReset().mockReturnValue({
    'deep-seek': {
      name: 'DeepSeek',
      url: 'https://api.deepseek.com/v1',
      apiKey: 'private-key',
      models: ['private-model'],
    },
    unlisted: { name: 'Unlisted', url: 'https://private-endpoint.example/v1' },
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('public provider icons', () => {
  it('returns only resolved logos for native providers and non-native catalog brands', async () => {
    const response = await GET()
    const icons = await response.json()
    expect(response.status).toBe(200)
    expect(icons).toEqual({
      openai: { src: svg('openai'), monochrome: true },
      deepseek: coloredLogo,
      elevenlabs: { src: svg('elevenlabs'), monochrome: true },
      'deep-seek': coloredLogo,
      unlisted: { src: 'https://models.dev/logos/unlisted.svg', monochrome: true },
    })
    expect(JSON.stringify(icons)).not.toMatch(
      /private-key|private-model|private-endpoint|api\.deepseek/
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=86400')
    expect(m.fetch).toHaveBeenCalledExactlyOnceWith(
      'https://raw.githubusercontent.com/lobehub/lobe-icons/v6.15.0/src/toc.json',
      { cache: 'force-cache', next: { revalidate: 86400 }, signal: expect.any(AbortSignal) }
    )
  })

  it('uses native metadata when it shares a key with a static catalog brand', async () => {
    m.providers.mockReturnValue({ deepseek: { name: 'OpenAI' } })
    const response = await GET()
    expect((await response.json()).deepseek).toEqual({
      src: 'https://models.dev/logos/deepseek.svg',
      monochrome: true,
    })
  })

  it.each([
    new Response('private-upstream-diagnostic', { status: 502 }),
    Response.json([]),
    Response.json({ error: 'private-upstream-diagnostic' }),
  ])('does not cache failed or unavailable catalogs', async (catalogResponse) => {
    m.fetch.mockResolvedValueOnce(catalogResponse)
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Provider icons are unavailable' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(m.providers).not.toHaveBeenCalled()
  })

  it('keeps request and registry failure diagnostics private', async () => {
    m.fetch.mockRejectedValueOnce(new Error('private-upstream-diagnostic'))
    expect((await GET()).status).toBe(503)
    m.providers.mockImplementationOnce(() => {
      throw new Error('private-registry-diagnostic')
    })
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Provider icons are unavailable' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
