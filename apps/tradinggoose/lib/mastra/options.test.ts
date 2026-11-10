import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { describe, expect, it } from 'vitest'
import {
  assertNativeToolArguments,
  NATIVE_AGENT_POLICY,
  trustedModelSettings,
  trustedPrepareStep,
  trustedProviderOptions,
} from './options'

describe('trusted native execution options', () => {
  it.each([null, false, 0, '', {}, { success: true }])(
    'rejects every root reserved resume value %j before native extraction',
    (resumeData) => {
      expect(() => assertNativeToolArguments({ resumeData })).toThrow('Native execution fields')
    }
  )
  it('keeps quoted/nested business fields as data but rejects inherited resume roots', () => {
    expect(() =>
      assertNativeToolArguments({ body: { resumeData: 'legitimate nested data' } })
    ).not.toThrow()
    expect(() => assertNativeToolArguments(Object.create({ resumeData: false }))).toThrow()
  })
  it.each([
    null,
    3,
    '0',
    { maxRetries: 1 },
    { maxRetries: null },
    { streamRetries: 1 },
    { model: 'other' },
    Object.create({ maxRetries: 4 }),
  ])('rejects caller retry/model/transport configuration %j', (value) => {
    expect(() => trustedModelSettings(value)).toThrow()
  })
  it.each([
    { openai: { transport: 'websocket' } },
    { openai: { websocket: { url: 'https://untrusted' } } },
    { openrouter: { model: 'other' } },
    { openrouter: { provider: { allow_fallbacks: true } } },
    { anthropic: { fallbacks: ['other'] } },
    { google: { headers: { authorization: 'untrusted' } } },
    { openai: { extraBody: { model: 'other' } } },
  ])('rejects executable provider overrides %j', (value) => {
    expect(() => trustedProviderOptions(value)).toThrow()
  })
  it('preserves supported generation controls without mutating caller objects', () => {
    const options = { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } }
    const accepted = trustedProviderOptions(options)!
    accepted.anthropic.thinking.budgetTokens = 2048
    expect(options.anthropic.thinking.budgetTokens).toBe(1024)
    expect(trustedModelSettings({ temperature: 0, maxOutputTokens: 25 })).toEqual({
      temperature: 0,
      maxOutputTokens: 25,
      maxRetries: 0,
    })
  })
  it('reasserts fetch/no fallback after Force and refuses a trusted substitution', async () => {
    const step = {
      model: 'openai/gpt-4.1',
      modelSettings: { maxRetries: 0 },
      providerOptions: {},
      steps: [],
    } as any
    const prepared = await trustedPrepareStep(step.model, () => ({
      toolChoice: { type: 'tool', toolName: 'lookup' },
    }))(step)
    expect(prepared).toMatchObject({
      toolChoice: { toolName: 'lookup' },
      modelSettings: { maxRetries: 0 },
      providerOptions: {
        openai: { transport: 'fetch' },
        azure: { transport: 'fetch' },
        openrouter: { provider: { allow_fallbacks: false } },
      },
    })
    await expect(
      trustedPrepareStep(step.model, () => ({ modelSettings: { maxRetries: 1 } }))(step)
    ).rejects.toThrow('cannot be replaced')
    await expect(
      trustedPrepareStep(step.model, () => ({ model: 'openai/gpt-4.1' }))(step)
    ).rejects.toThrow('cannot be replaced')
  })
  it('uses empty public error lanes and delegates a retryable failure once', async () => {
    let calls = 0
    const model = new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        calls++
        throw new Error('fixture retryable upstream failure')
      },
    })
    const agent = new Agent({
      ...NATIVE_AGENT_POLICY,
      id: 'retry-fixture',
      name: 'retry fixture',
      instructions: '',
      model,
    })
    expect(await agent.listErrorProcessors()).toHaveLength(0)
    try {
      await agent.generate('test', {
        modelSettings: trustedModelSettings(),
        prepareStep: trustedPrepareStep(model),
        maxProcessorRetries: 0,
      })
    } catch {}
    expect(calls).toBe(1)
  })
})

it('rejects a different configured public router even with matching display identity', async () => {
  const { ModelRouterLanguageModel } = await import('@mastra/core/llm')
  const admitted = new ModelRouterLanguageModel({ id: 'openai/gpt-4.1', apiKey: 'fixture-a' })
  const substituted = new ModelRouterLanguageModel({ id: 'openai/gpt-4.1', apiKey: 'fixture-b' })
  await expect(
    trustedPrepareStep(admitted)({ model: substituted, modelSettings: { maxRetries: 0 } } as any)
  ).rejects.toThrow('admitted selection')
})
