import { describe, expect, it } from 'vitest'
import { mapToThinkingBudget, supportsDisablingGemini25Thinking } from '@/providers/ai/google/utils'

describe('Gemini 2.5 thinking configuration', () => {
  it('maps named levels to each model family budget', () => {
    expect(mapToThinkingBudget('gemini-2.5-pro', 'low')).toBe(2048)
    expect(mapToThinkingBudget('gemini-2.5-flash', 'high')).toBe(24576)
    expect(mapToThinkingBudget('vertex/gemini-2.5-flash-lite', 'medium')).toBe(8192)
  })

  it('uses the model high budget for an unknown level and dynamic budget for an unknown model', () => {
    expect(mapToThinkingBudget('gemini-2.5-pro', 'unexpected')).toBe(32768)
    expect(mapToThinkingBudget('gemini-unknown', 'high')).toBe(-1)
  })

  it('only allows explicit thinking disablement on Flash models', () => {
    expect(supportsDisablingGemini25Thinking('gemini-2.5-flash')).toBe(true)
    expect(supportsDisablingGemini25Thinking('vertex/gemini-2.5-flash-lite')).toBe(true)
    expect(supportsDisablingGemini25Thinking('gemini-2.5-pro')).toBe(false)
  })
})
