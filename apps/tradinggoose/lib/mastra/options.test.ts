import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { expect, it } from 'vitest'
import {
  assertNativeToolArguments,
  NATIVE_AGENT_POLICY,
  parseProviderOptions,
  trustedModelSettings,
} from './options'

it('keeps model selection, retry policy, and provider connections server-owned', () => {
  expect(() => trustedModelSettings({ maxRetries: 2 })).toThrow()
  expect(() => trustedModelSettings({ model: 'other' })).toThrow()
  expect(() => parseProviderOptions({ openai: { headers: {} } })).toThrow()
  expect(() => parseProviderOptions('{')).toThrow()
  expect(parseProviderOptions({ openai: { reasoningEffort: 'low' } })).toMatchObject({
    openai: { reasoningEffort: 'low', transport: 'fetch' },
    openrouter: { provider: { allow_fallbacks: false } },
  })
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
  ).toEqual({ temperature: 0, maxOutputTokens: 128, topP: 0.5, seed: 0, maxRetries: 0 })
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
it('does not retry a failed model contact', async () => {
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      throw new Error('upstream failure')
    },
  })
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'test',
    name: 'Test',
    instructions: '',
    model,
  })
  await expect(agent.generate('Test')).rejects.toThrow()
  expect(model.doGenerateCalls).toHaveLength(1)
})
