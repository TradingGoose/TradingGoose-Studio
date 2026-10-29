import { describe, expect, it, vi } from 'vitest'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import type { SubBlockCondition } from '@/blocks/types'
import { getWorkflowInspectorCopy, type LocaleCode } from '@/i18n/block-editor'
import { getProviderModels } from '@/providers/ai/models'
import { buildTriggerEditingLayout } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/trigger-editing-layout'
import { AgentBlock } from './agent'
import { EvaluatorBlock } from './evaluator'
import { RouterBlock } from './router'

const inspectorLayout = (model?: string, locale: LocaleCode = 'en') =>
  buildTriggerEditingLayout({
    inspectorCopy: getWorkflowInspectorCopy(locale),
    blockType: 'agent',
    blockConfig: AgentBlock,
    blockState: { subBlocks: { model: { value: model } } },
    shouldDisableWrite: false,
  })

describe('AgentBlock', () => {
  it.each([false, true])(
    'matches API-key requirements to hosted=%s credentials',
    async (hosted) => {
      vi.doMock('@/lib/environment', async (importOriginal) => ({
        ...(await importOriginal<typeof import('@/lib/environment')>()),
        isHosted: hosted,
      }))
      vi.resetModules()
      try {
        const { AgentBlock: block } = await import('./agent')
        const { useProvidersStore } = await import('@/stores/providers/store')
        useProvidersStore.setState((state) => ({
          providers: {
            ...state.providers,
            ollama: { models: ['ollama/llama3.2:latest'], isLoading: false },
          },
        }))
        const field = block.subBlocks.find((field) => field.id === 'apiKey')!
        for (const [model, required] of [
          ['gpt-4.1', !hosted],
          ['claude-haiku-4-5', !hosted],
          ['mistral-large-latest', true],
          ['azure/gpt-4.1', true],
          ['openrouter/openai/gpt-4.1', true],
        ] as const) {
          expect(evaluateSubBlockConditionValues(field.condition, { model })).toBe(true)
          expect(evaluateSubBlockConditionValues(field.required, { model })).toBe(required)
        }
        expect(
          evaluateSubBlockConditionValues(field.condition, { model: 'ollama/llama3.2:latest' })
        ).toBe(hosted)
      } finally {
        vi.doUnmock('@/lib/environment')
        vi.resetModules()
      }
    }
  )

  it.each([AgentBlock, RouterBlock, EvaluatorBlock])(
    'resolves $name Ollama provider identity without browser model discovery',
    (block) => {
      expect(getProviderModels('ollama')).toEqual([])
      expect(block.tools.config!.tool({ model: 'ollama/llama3.2:latest' })).toBe('ollama')
    }
  )

  it('uses additional fields without mode switches or forced tuning defaults', () => {
    expect(AgentBlock.subBlocks.some((field) => field.mode)).toBe(false)
    const coreFields = inspectorLayout('gpt-4.1')
      .regularRows.flat()
      .map((field) => field.id)
    expect(coreFields.slice(coreFields.indexOf('tools'), coreFields.indexOf('tools') + 2)).toEqual([
      'tools',
      'skills',
    ])
    for (const id of [
      'memories',
      'responseFormat',
      'temperature',
      'maxTokens',
      'reasoningEffort',
      'verbosity',
      'thinkingLevel',
    ]) {
      const field = AgentBlock.subBlocks.find((field) => field.id === id)!
      expect(field.additional).toBe(true)
      expect(field.defaultValue).toBeUndefined()
      expect(field.value).toBeUndefined()
    }
  })

  it.each([
    ['reasoningEffort', 'gpt-5.4', ['none', 'low', 'medium', 'high', 'xhigh']],
    ['reasoningEffort', 'gpt-5.6-sol', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['reasoningEffort', 'gpt-6.1-sol', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['reasoningEffort', 'deepseek-v4-pro', ['low', 'high', 'max']],
    ['thinkingLevel', 'claude-sonnet-5-5', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['thinkingLevel', 'claude-haiku-5-5', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['thinkingLevel', 'claude-haiku-4-5', ['low', 'medium', 'high']],
    ['thinkingLevel', 'deepseek-flash', ['none', 'enabled']],
    ['thinkingLevel', 'gemini-2.5-flash', ['none', 'low', 'medium', 'high']],
    ['thinkingLevel', 'gemini-2.5-flash-lite', ['none', 'low', 'medium', 'high']],
    ['thinkingLevel', 'vertex/gemini-2.5-flash', ['none', 'low', 'medium', 'high']],
    ['thinkingLevel', 'vertex/gemini-2.5-flash-lite', ['none', 'low', 'medium', 'high']],
    ['verbosity', 'gpt-5.6-sol', ['low', 'medium', 'high']],
  ] as const)('resolves %s for %s from the selected model', (id, model, levels) => {
    for (const locale of ['en', 'es', 'zh'] as const) {
      const fields = inspectorLayout(model, locale).additionalRows.flat()
      expect(fields.map((field) => field.id)).toContain(id)
      const field = fields.find((field) => field.id === id)!
      if (typeof field.options !== 'function') throw new Error('Expected model-dependent options')
      expect(field.options({ model }).map((option) => option.id)).toEqual(['auto', ...levels])
      expect(field.autoSelectFirstOption).toBe(false)
    }
  })

  it.each([
    ['reasoningEffort', 'gpt-4.1'],
    ['thinkingLevel', 'gpt-4.1'],
    ['thinkingLevel', 'unknown-model'],
    ['thinkingLevel', undefined],
    ['reasoningEffort', 'claude-haiku-4-5'],
    ['verbosity', 'claude-haiku-4-5'],
  ])('hides unsupported %s controls for %s', (id, model) => {
    const field = AgentBlock.subBlocks.find((field) => field.id === id)!
    expect(evaluateSubBlockConditionValues(field.condition, { model })).toBe(false)
    expect(
      inspectorLayout(model)
        .additionalRows.flat()
        .map((field) => field.id)
    ).not.toContain(id)
  })

  it.each([
    ['gpt-4.1', 2],
    ['claude-haiku-4-5', 1],
    ['mistral-large-latest', 1.5],
  ] as const)('uses a clearable temperature slider for %s', (model, max) => {
    const fields = inspectorLayout(model)
      .additionalRows.flat()
      .filter((field) => field.id === 'temperature')
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ type: 'slider', min: 0, max, step: 0.1, clearable: true })
    expect(fields[0].defaultValue).toBeUndefined()
    expect(fields[0].value).toBeUndefined()
  })

  it('preserves serializable capability conditions, negation, and dependencies', () => {
    const condition: SubBlockCondition = {
      field: 'model',
      operator: 'modelCapability',
      value: 'thinkingLevel',
      and: { field: 'enabled', value: true },
    }
    const restored = JSON.parse(JSON.stringify(condition))
    const values = { model: { id: 'claude-haiku-4-5' }, enabled: true }
    expect(evaluateSubBlockConditionValues(restored, values)).toBe(true)
    expect(evaluateSubBlockConditionValues(restored, { ...values, enabled: false })).toBe(false)
    expect(evaluateSubBlockConditionValues({ ...condition, not: true }, values)).toBe(false)
  })

  it.each([
    ['gpt-4.1', 16],
    ['gpt-6.1-sol', 16],
    ['azure/gpt-6.1-sol', 16],
    ['claude-haiku-4-5', 1],
    ['openrouter/custom/manual', 1],
    ['c', 1],
  ] as const)('uses the selected model token minimum for %s', (model, min) => {
    const fields = inspectorLayout(model)
      .additionalRows.flat()
      .filter((field) => field.id === 'maxTokens')
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ min, integer: true, inputType: 'number' })
  })
})
