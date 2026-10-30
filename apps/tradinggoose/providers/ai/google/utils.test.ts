import { describe, expect, it } from 'vitest'
import {
  convertUsageMetadata,
  mapToThinkingBudget,
  mapToThinkingLevel,
  supportsDisablingGemini25Thinking,
} from '@/providers/ai/google/utils'

it.each([undefined, 0, 5000, 10000])(
  'preserves Gemini cache hits=%s in usage conversion',
  (cachedContentTokenCount) => {
    expect(
      convertUsageMetadata({
        promptTokenCount: 10000,
        toolUsePromptTokenCount: 50,
        candidatesTokenCount: 80,
        thoughtsTokenCount: 20,
        totalTokenCount: 10150,
        cachedContentTokenCount,
      })
    ).toEqual({
      promptTokenCount: 10050,
      candidatesTokenCount: 100,
      totalTokenCount: 10150,
      cachedContentTokenCount: cachedContentTokenCount ?? 0,
    })
  }
)

describe('Gemini 2.5 thinking configuration', () => {
  it('maps named levels to each model family budget', () => {
    expect(mapToThinkingBudget('gemini-2.5-pro', 'low')).toBe(2048)
    expect(mapToThinkingBudget('gemini-2.5-flash', 'high')).toBe(24576)
    expect(mapToThinkingBudget('vertex/gemini-2.5-flash-lite', 'medium')).toBe(8192)
  })

  it.each([
    ['gemini-2.5-pro', 'minimal'],
    ['gemini-2.5-pro', 'unexpected'],
    ['gemini-unknown', 'high'],
  ])('rejects an unsupported thinking budget for %s at %s', (model, level) => {
    expect(() => mapToThinkingBudget(model, level)).toThrow('Unknown Gemini thinking budget')
  })

  it('rejects an unknown named thinking level', () => {
    expect(() => mapToThinkingLevel('unexpected')).toThrow('Unknown Gemini thinking level')
  })

  it('only allows explicit thinking disablement on Flash models', () => {
    expect(supportsDisablingGemini25Thinking('gemini-2.5-flash')).toBe(true)
    expect(supportsDisablingGemini25Thinking('vertex/gemini-2.5-flash-lite')).toBe(true)
    expect(supportsDisablingGemini25Thinking('gemini-2.5-pro')).toBe(false)
  })
})
