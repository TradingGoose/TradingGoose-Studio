import { expect, it } from 'vitest'
import { assertNativeToolArguments, parseProviderOptions, trustedModelSettings } from './options'

it('keeps model selection and provider connections server-owned', () => {
  expect(() => trustedModelSettings({ maxRetries: 2 })).toThrow()
  expect(() => trustedModelSettings({ model: 'other' })).toThrow()
  expect(() => parseProviderOptions({ openai: { headers: {} } })).toThrow()
  expect(() => parseProviderOptions('{')).toThrow()
  expect(parseProviderOptions({ openai: { reasoningEffort: 'low' } })).toEqual({
    openai: { reasoningEffort: 'low' },
  })
})
it('leaves native defaults unset and preserves explicitly supplied generation options', () => {
  expect(trustedModelSettings()).toEqual({})
  expect(parseProviderOptions()).toEqual({})
  for (const store of [true, false])
    expect(parseProviderOptions({ openai: { store } })).toEqual({ openai: { store } })
})
it.each(['serviceTier', 'service_tier'])(
  'rejects provider service-tier option %s before inference',
  (key) => {
    expect(() => parseProviderOptions({ openai: { [key]: 'flex' } })).toThrow(
      `Provider option openai.${key} is controlled by the server`
    )
  }
)
it('normalizes numeric editor controls and omits unset values without supplying defaults', () => {
  expect(
    trustedModelSettings({
      temperature: '0',
      maxOutputTokens: '128',
      topP: '0.5',
      topK: '',
      presencePenalty: '  ',
      frequencyPenalty: null,
      seed: '0',
    })
  ).toEqual({ temperature: 0, maxOutputTokens: 128, topP: 0.5, seed: 0 })
})
it.each([
  { temperature: '0.5invalid' },
  { temperature: false },
  { topP: 'Infinity' },
  { maxOutputTokens: '1.5' },
  { maxOutputTokens: '0' },
  { seed: '1.5' },
  { stopSequences: ['ok', 1] },
  { reasoning: 'invented' },
])('rejects invalid native settings before inference: %j', (settings) => {
  expect(() => trustedModelSettings(settings)).toThrow()
})
it('rejects native resume controls in model-authored tool arguments', () => {
  expect(() => assertNativeToolArguments({ resumeData: {} })).toThrow('Native execution fields')
  expect(() => assertNativeToolArguments({ body: { resumeData: 'business data' } })).not.toThrow()
})
