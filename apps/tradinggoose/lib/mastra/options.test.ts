import { expect, it } from 'vitest'
import { parseNativeToolArguments, parseProviderOptions, trustedModelSettings } from './options'

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
  { reasoning: 'high' },
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

it('preserves native provider fields without a Studio capability list or conversion', () => {
  const options = {
    openai: {
      reasoningEffort: 'high',
      textVerbosity: 'low',
      promptCacheKey: 'cache-key',
      promptCacheRetention: '24h',
      metadata: { model: 'audit-label', prompt: 'audit-label' },
    },
    anthropic: {
      thinking: { type: 'enabled', budgetTokens: 4096 },
      cacheControl: { type: 'ephemeral' },
    },
    google: {
      thinkingConfig: { thinkingBudget: 4096, includeThoughts: true },
      cachedContent: 'cachedContents/reference',
    },
    'future-provider': { futureGenerationControl: { value: 1 } },
  }
  expect(parseProviderOptions(options)).toEqual(options)
  expect(parseProviderOptions(JSON.stringify(options))).toEqual(options)
  expect(parseProviderOptions('')).toEqual({})
})

it.each([
  { anthropic: { mcpServers: [{ type: 'url', url: 'https://mcp.example.test' }] } },
  { anthropic: { container: { skills: [{ skillId: 'unapproved' }] } } },
  { openai: { reasoningEffort: 'high', model: 'unapproved' } },
  { openai: { serviceTier: 'priority' } },
  { google: { thinkingConfig: { thinkingBudget: 4096, tools: [] } } },
  { other: { thinking: { url: 'http://127.0.0.1' } } },
  { other: { reasoning: { nested: [{ authorizationToken: 'secret' }] } } },
  { other: { extraBody: { reasoning_effort: 'low' } } },
  [],
  null,
])('rejects execution authority inside native provider options: %j', (options) => {
  expect(() => parseProviderOptions(options)).toThrow()
})
