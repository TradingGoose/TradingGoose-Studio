import { describe, expect, it } from 'vitest'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { buildSubBlockPreviewRows } from '@/lib/workflows/sub-block-rows'
import type { SubBlockCondition } from '@/blocks/types'
import { getProviderModels } from '@/providers/ai/models'
import { AgentBlock } from './agent'
import { EvaluatorBlock } from './evaluator'
import { RouterBlock } from './router'

describe('AgentBlock', () => {
  it.each([AgentBlock, RouterBlock, EvaluatorBlock])(
    'resolves $name Ollama provider identity without browser model discovery',
    (block) => {
      expect(getProviderModels('ollama')).toEqual([])
      expect(block.tools.config!.tool({ model: 'ollama/llama3.2:latest' })).toBe('ollama')
    }
  )

  it('uses additional fields without mode switches or forced tuning defaults', () => {
    expect(AgentBlock.subBlocks.some((field) => field.mode)).toBe(false)
    for (const id of [
      'memories',
      'skills',
      'responseFormat',
      'temperature',
      'maxTokens',
      'reasoningEffort',
      'verbosity',
      'thinkingLevel',
    ]) {
      const field = AgentBlock.subBlocks.find((field) => field.id === id)!
      expect(field.additional).toBe(true)
      if (id !== 'skills') expect(field.defaultValue).toBeUndefined()
      expect(field.value).toBeUndefined()
    }
  })

  it.each([
    ['reasoningEffort', 'gpt-5.4-2026-03-05', ['none', 'low', 'medium', 'high', 'xhigh']],
    ['verbosity', 'gpt-5.4-2026-03-05', ['low', 'medium', 'high']],
    ['reasoningEffort', 'gpt-5.6-sol', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['reasoningEffort', 'deepseek-v4-pro', ['high', 'max']],
    ['thinkingLevel', 'claude-sonnet-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['thinkingLevel', 'claude-opus-4-5-20251101', ['low', 'medium', 'high']],
    ['thinkingLevel', 'deepseek-v4-flash', ['none', 'enabled']],
    ['thinkingLevel', 'gemini-2.5-flash', ['none', 'low', 'medium', 'high']],
    ['thinkingLevel', 'gemini-2.5-flash-lite', ['none', 'low', 'medium', 'high']],
    ['thinkingLevel', 'vertex/gemini-2.5-flash', ['none', 'low', 'medium', 'high']],
    ['thinkingLevel', 'vertex/gemini-2.5-flash-lite', ['none', 'low', 'medium', 'high']],
    ['verbosity', 'gpt-5.6-sol', ['low', 'medium', 'high']],
  ] as const)('resolves %s for %s from the selected model', (id, model, levels) => {
    const field = AgentBlock.subBlocks.find((field) => field.id === id)!
    const visibleFields = buildSubBlockPreviewRows({
      subBlocks: AgentBlock.subBlocks,
      stateToUse: { model: { value: model }, [id]: { value: levels[0] } },
    })
    expect(visibleFields.map((entry) => entry.id)).toContain(id)
    if (typeof field.options !== 'function') throw new Error('Expected model-dependent options')
    expect(field.options({ model }).map((option) => option.id)).toEqual(['auto', ...levels])
    expect(field.autoSelectFirstOption).toBe(false)
  })

  it.each([
    ['thinkingLevel', 'gpt-4.1'],
    ['thinkingLevel', 'unknown-model'],
    ['thinkingLevel', undefined],
    ['reasoningEffort', 'claude-opus-4-5-20251101'],
    ['verbosity', 'claude-opus-4-5-20251101'],
  ])('hides unsupported %s controls for %s', (id, model) => {
    const field = AgentBlock.subBlocks.find((field) => field.id === id)!
    expect(evaluateSubBlockConditionValues(field.condition, { model })).toBe(false)
  })

  it('preserves serializable capability conditions, negation, and dependencies', () => {
    const condition: SubBlockCondition = {
      field: 'model',
      operator: 'modelCapability',
      value: 'thinkingLevel',
      and: { field: 'enabled', value: true },
    }
    const restored = JSON.parse(JSON.stringify(condition))
    const values = { model: { id: 'claude-opus-4-5-20251101' }, enabled: true }
    expect(evaluateSubBlockConditionValues(restored, values)).toBe(true)
    expect(evaluateSubBlockConditionValues(restored, { ...values, enabled: false })).toBe(false)
    expect(evaluateSubBlockConditionValues({ ...condition, not: true }, values)).toBe(false)
  })
})
