import { describe, expect, it } from 'vitest'
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
    ['reasoningEffort', 'gpt-5.6-sol', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['reasoningEffort', 'deepseek-v4-pro', ['high', 'max']],
    ['thinkingLevel', 'claude-sonnet-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['thinkingLevel', 'deepseek-v4-flash', ['none', 'enabled']],
    ['verbosity', 'gpt-5.6-sol', ['low', 'medium', 'high']],
  ] as const)('resolves %s for %s from the selected model', (id, model, levels) => {
    const field = AgentBlock.subBlocks.find((field) => field.id === id)!
    if (typeof field.options !== 'function') throw new Error('Expected model-dependent options')
    expect(field.options({ model }).map((option) => option.id)).toEqual(['auto', ...levels])
    expect(field.autoSelectFirstOption).toBe(false)
  })
})
