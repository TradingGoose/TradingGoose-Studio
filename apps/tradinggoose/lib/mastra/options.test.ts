import { expect, it } from 'vitest'
import { parseNativeToolArguments, trustedModelSettings } from './options'

it('keeps model selection and provider connections server-owned', () => {
  expect(() => trustedModelSettings({ maxRetries: 2 })).toThrow()
  expect(() => trustedModelSettings({ model: 'other' })).toThrow()
})
it('leaves native defaults unset and preserves explicitly supplied generation options', () => {
  expect(trustedModelSettings()).toEqual({})
})
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
  { anthropic: { mcpServers: [{ url: 'https://mcp.example.test' }] } },
  { providerOptions: { anthropic: { mcpServers: [] } } },
])('rejects invalid native settings before inference: %j', (settings) => {
  expect(() => trustedModelSettings(settings)).toThrow()
})
it('rejects native resume controls in model-authored tool arguments', () => {
  expect(() => parseNativeToolArguments({ resumeData: {} })).toThrow('Native execution fields')
  const args = { body: { resumeData: 'business data' } }
  expect(parseNativeToolArguments(JSON.stringify(args))).toEqual(args)
})
