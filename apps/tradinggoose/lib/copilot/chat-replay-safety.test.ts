import { describe, expect, it } from 'vitest'
import { hasToolActivityAfterMessage } from '@/lib/copilot/chat-replay-safety'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import type { CopilotMessage } from '@/stores/copilot/types'

const user: CopilotMessage = {
  id: 'user',
  role: 'user',
  content: 'Hello',
  timestamp: '2026-11-11T00:00:00Z',
}

describe('native history edit safety', () => {
  it.each([
    ClientToolCallState.success,
    ClientToolCallState.error,
    ClientToolCallState.rejected,
    ClientToolCallState.pending,
  ])('preserves later tool activity regardless of outcome (%s)', (state) => {
    const messages: CopilotMessage[] = [
      user,
      {
        id: 'assistant',
        role: 'assistant',
        content: '',
        timestamp: user.timestamp,
        contentBlocks: [
          {
            type: 'tool_call',
            timestamp: 1,
            toolCall: { id: 'read', name: 'read_workflow', state },
          },
        ],
      },
    ]
    expect(hasToolActivityAfterMessage(messages, user.id)).toBe(true)
    expect(hasToolActivityAfterMessage(messages, 'assistant')).toBe(false)
    expect(hasToolActivityAfterMessage(messages, 'missing')).toBe(false)
  })
  it('allows editing when later messages contain only text or reasoning', () => {
    expect(
      hasToolActivityAfterMessage(
        [
          user,
          {
            ...user,
            id: 'assistant',
            role: 'assistant',
            contentBlocks: [
              { type: 'text', content: 'Reply', timestamp: 1 },
              { type: 'thinking', content: 'Reasoning', timestamp: 1 },
            ],
          },
        ],
        user.id
      )
    ).toBe(false)
  })
})
