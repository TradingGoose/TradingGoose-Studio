import { describe, expect, it } from 'vitest'
import { type ProviderLogoCatalogEntry, resolveProviderLogo } from './provider-logos'

// Public entries from @lobehub/icons 6.15.0's published catalog.
const catalog: ProviderLogoCatalogEntry[] = [
  {
    id: 'DeepSeek',
    title: 'DeepSeek',
    fullTitle: 'DeepSeek',
    desc: 'https://deepseek.com',
    param: { hasColor: true },
  },
  {
    id: 'OpenAI',
    title: 'OpenAI',
    fullTitle: 'OpenAI (ChatGPT)',
    desc: 'https://openai.com',
    param: { hasColor: false },
  },
  {
    id: 'Anthropic',
    title: 'Anthropic',
    fullTitle: 'Anthropic',
    desc: 'https://anthropic.com',
    param: { hasColor: false },
  },
  {
    id: 'GmiCloud',
    title: 'GmiCloud',
    fullTitle: 'GMI Cloud',
    desc: 'https://gmicloud.ai',
    param: { hasColor: false },
  },
  { id: 'Poe', title: 'Poe', fullTitle: 'Poe', desc: 'https://poe.com', param: { hasColor: true } },
  {
    id: 'Fireworks',
    title: 'Fireworks',
    fullTitle: 'Fireworks',
    desc: 'https://fireworks.ai',
    param: { hasColor: true },
  },
  {
    id: 'Meta',
    title: 'Meta',
    fullTitle: 'Meta',
    desc: 'https://llama.meta.com',
    param: { hasColor: true },
  },
  {
    id: 'MetaAI',
    title: 'MetaAI',
    fullTitle: 'MetaAI',
    desc: 'https://meta.ai',
    param: { hasColor: true },
  },
]
const color = (id: string) => ({
  src: `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-webp@2.6.0/light/${id}-color.webp`,
  darkSrc: `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-webp@2.6.0/dark/${id}-color.webp`,
  monochrome: false,
})
const svg = (file: string) =>
  `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/${file}.svg`

describe('public provider logo resolution', () => {
  it.each([
    ['deepseek', 'DeepSeek', 'deepseek', false],
    ['gmicloud', 'GMI Cloud', 'gmicloud', true],
    ['poe', 'Poe', 'poe', false],
    ['openai', 'OpenAI', 'openai', true],
    ['anthropic', 'Anthropic', 'anthropic', true],
  ] as const)(
    'uses the upstream variant for native provider %s without changing its identity',
    (id, name, file, monochrome) => {
      const provider = { id, name }
      expect(resolveProviderLogo(provider, catalog)).toEqual(
        monochrome ? { src: svg(file), monochrome } : color(file)
      )
      expect(provider).toEqual({ id, name })
    }
  )

  it('matches punctuation and case in IDs and display names without stripping words', () => {
    expect(resolveProviderLogo({ id: 'gmi-cloud', name: 'GMI CLOUD' }, catalog)).toEqual({
      src: svg('gmicloud'),
      monochrome: true,
    })
    expect(
      resolveProviderLogo({ id: 'new-openai-connection', name: 'OpenAI (ChatGPT)' }, catalog)
    ).toEqual({ src: svg('openai'), monochrome: true })
    expect(resolveProviderLogo({ id: 'fireworks-ai', name: 'Fireworks AI' }, catalog)).toEqual({
      src: 'https://models.dev/logos/fireworks-ai.svg',
      monochrome: true,
    })
  })

  it('folds accented identity characters without changing the selected provider', () => {
    const provider = { id: 'd\u00e9ep-s\u00e8ek', name: 'D\u00c9EP S\u00c8EK' }
    expect(resolveProviderLogo(provider, catalog)).toEqual(color('deepseek'))
    expect(provider.id).toBe('d\u00e9ep-s\u00e8ek')
  })

  it.each([
    'https://fireworks.ai/v1',
    'https://api.fireworks.ai/inference/v1',
    'https://API.FIREWORKS.AI.:443/v1',
  ])('uses a unique public catalog domain for %s', (url) => {
    expect(resolveProviderLogo({ id: 'fireworks-ai', name: 'Fireworks AI', url }, catalog)).toEqual(
      color('fireworks')
    )
  })

  it('preserves a unique brand identity when its API domain identifies another brand', () => {
    expect(
      resolveProviderLogo({ id: 'meta', name: 'Meta', url: 'https://api.meta.ai/v1' }, catalog)
    ).toEqual(color('meta'))
  })

  it('rejects an ambiguous identity even when the API domain would select one candidate', () => {
    const collision = [...catalog, { ...catalog[0], id: 'AnotherBrand', title: 'DeepSeek' }]
    expect(
      resolveProviderLogo(
        { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com' },
        collision
      )
    ).toEqual({ src: 'https://models.dev/logos/deepseek.svg', monochrome: true })
  })

  it('rejects a shared website rather than guessing between its brands', () => {
    const shared = [
      ...catalog,
      {
        id: 'AnotherBrand',
        title: 'AnotherBrand',
        fullTitle: 'AnotherBrand',
        desc: 'https://fireworks.ai/another-product',
        param: { hasColor: true },
      },
    ]
    expect(
      resolveProviderLogo(
        { id: 'new-provider', name: 'New Provider', url: 'https://api.fireworks.ai' },
        shared
      )
    ).toEqual({ src: 'https://models.dev/logos/new-provider.svg', monochrome: true })
  })

  it.each([
    'https://evilfireworks.ai',
    'https://api.evilfireworks.ai',
    'https://fireworks.ai.evil.example',
    'https://fireworks.ai@evil.example',
    'ftp://api.fireworks.ai',
    'not a URL',
  ])('rejects an unrelated or invalid API website %s', (url) => {
    expect(resolveProviderLogo({ id: 'unknown', name: 'Unknown', url }, catalog)).toEqual({
      src: 'https://models.dev/logos/unknown.svg',
      monochrome: true,
    })
  })

  it.each(['frogbot', 'hyper', 'tensorx', 'vivgrid'])(
    'keeps the native monochrome source for uncataloged provider %s',
    (id) => {
      expect(resolveProviderLogo({ id, name: id }, catalog)).toEqual({
        src: `https://models.dev/logos/${id}.svg`,
        monochrome: true,
      })
    }
  )

  it('preserves the exact provider ID and encodes it as one image path segment when unmatched', () => {
    expect(resolveProviderLogo({ id: 'Example/New Provider', name: 'Unlisted' }, [])).toEqual({
      src: 'https://models.dev/logos/Example%2FNew%20Provider.svg',
      monochrome: true,
    })
  })
})
