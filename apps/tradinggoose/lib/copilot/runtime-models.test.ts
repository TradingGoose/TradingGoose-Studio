import { describe, expect, it } from 'vitest'
import { COPILOT_RUNTIME_MODELS, DEFAULT_COPILOT_RUNTIME_MODEL } from '@/lib/copilot/runtime-models'

describe('Copilot runtime models', () => {
  it('exposes the supported model list', () => {
    expect(COPILOT_RUNTIME_MODELS).toEqual([
      'deepseek/deepseek-v4-pro',
      'openai/gpt-5.6-terra',
      'openai/gpt-5.6-sol',
      'anthropic/claude-fable-5',
      'anthropic/claude-opus-5',
      'x-ai/grok-4.6',
    ])
  })

  it('uses Claude Fable 5 by default and exposes unique model ids', () => {
    expect(DEFAULT_COPILOT_RUNTIME_MODEL).toBe('anthropic/claude-fable-5')
    expect(COPILOT_RUNTIME_MODELS).toContain(DEFAULT_COPILOT_RUNTIME_MODEL)
    expect(new Set(COPILOT_RUNTIME_MODELS).size).toBe(COPILOT_RUNTIME_MODELS.length)
  })
})
