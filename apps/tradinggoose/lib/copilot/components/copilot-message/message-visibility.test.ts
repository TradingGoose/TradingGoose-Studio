import { describe, expect, it } from 'vitest'
import { shouldRenderAssistantOptions } from './message-visibility'

describe('shouldRenderAssistantOptions', () => {
  it('renders options only for the latest assistant message', () => {
    expect(
      shouldRenderAssistantOptions({
        role: 'assistant',
        isLastMessage: true,
        hasOptions: true,
      })
    ).toBe(true)

    expect(
      shouldRenderAssistantOptions({
        role: 'assistant',
        isLastMessage: false,
        hasOptions: true,
      })
    ).toBe(false)
  })

  it('does not render options for user messages or messages without options', () => {
    expect(
      shouldRenderAssistantOptions({
        role: 'user',
        isLastMessage: true,
        hasOptions: true,
      })
    ).toBe(false)

    expect(
      shouldRenderAssistantOptions({
        role: 'assistant',
        isLastMessage: true,
        hasOptions: false,
      })
    ).toBe(false)
  })
})
