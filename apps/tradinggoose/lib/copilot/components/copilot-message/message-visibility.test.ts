import { describe, expect, it } from 'vitest'
import { shouldRenderAssistantOptions } from './message-visibility'

describe('shouldRenderAssistantOptions', () => {
  it.each([
    ['latest assistant with options', 'assistant', true, true, true],
    ['older assistant', 'assistant', false, true, false],
    ['user message', 'user', true, true, false],
    ['assistant without options', 'assistant', true, false, false],
  ])('%s', (_case, role, isLastMessage, hasOptions, expected) => {
    expect(shouldRenderAssistantOptions({ role, isLastMessage, hasOptions })).toBe(expected)
  })
})
