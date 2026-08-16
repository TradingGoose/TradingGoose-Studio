import { describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { normalizeMessagesForUI } from './store-messages'
import type { CopilotMessage } from './types'

describe('normalizeMessagesForUI', () => {
  it('moves reasoning-only JSON prefixes out of assistant text content', () => {
    const [message] = normalizeMessagesForUI([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: `${JSON.stringify({ reasoning: 'Internal reasoning.' })}\n\nVisible reply.`,
        timestamp: '2026-04-28T00:00:00.000Z',
      },
    ])

    expect(message.content).toBe('Visible reply.')
    expect(message.contentBlocks).toMatchObject([
      {
        type: 'thinking',
        content: 'Internal reasoning.',
      },
      {
        type: 'text',
        content: 'Visible reply.',
      },
    ])
  })

  it('normalizes persisted assistant text blocks with reasoning JSON prefixes', () => {
    const [message] = normalizeMessagesForUI([
      {
        id: 'assistant-2',
        role: 'assistant',
        content: '',
        timestamp: '2026-04-28T00:00:00.000Z',
        contentBlocks: [
          {
            type: 'text',
            content: `${JSON.stringify({ reasoning: 'Block reasoning.' })}\n\nBlock reply.`,
            timestamp: 1,
            itemId: 'text-1',
          },
        ],
      } satisfies CopilotMessage,
    ])

    expect(message.contentBlocks).toMatchObject([
      {
        type: 'thinking',
        content: 'Block reasoning.',
        itemId: 'text-1-reasoning',
      },
      {
        type: 'text',
        content: 'Block reply.',
        itemId: 'text-1',
      },
    ])
  })

  it('uses explicit reply text from full JSON assistant envelopes', () => {
    const [message] = normalizeMessagesForUI([
      {
        id: 'assistant-3',
        role: 'assistant',
        content: JSON.stringify({
          reasoning: 'Envelope reasoning.',
          reply: 'Envelope reply.',
        }),
        timestamp: '2026-04-28T00:00:00.000Z',
      },
    ])

    expect(message.content).toBe('Envelope reply.')
    expect(message.contentBlocks).toMatchObject([
      {
        type: 'thinking',
        content: 'Envelope reasoning.',
      },
      {
        type: 'text',
        content: 'Envelope reply.',
      },
    ])
  })

  it('preserves content-level reasoning when assistant content blocks already exist', () => {
    const input = {
      id: 'assistant-4',
      role: 'assistant',
      content: `${JSON.stringify({ reasoning: 'Content reasoning.' })}\n\nVisible reply.`,
      timestamp: '2026-04-28T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool_call',
          timestamp: 1,
          toolCall: {
            id: 'tool-1',
            name: 'read_workflow',
            state: ClientToolCallState.success,
          },
        },
      ],
    } satisfies CopilotMessage
    const [message] = normalizeMessagesForUI([input])
    const [normalizedAgain] = normalizeMessagesForUI([input])

    expect(message.content).toBe('Visible reply.')
    expect(message.contentBlocks).toMatchObject([
      {
        type: 'thinking',
        content: 'Content reasoning.',
        timestamp: Date.parse(input.timestamp),
      },
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool-1',
        },
      },
      {
        type: 'text',
        content: 'Visible reply.',
        timestamp: Date.parse(input.timestamp),
      },
    ])
    expect((normalizedAgain.contentBlocks?.[0] as any)?.timestamp).toBe(
      (message.contentBlocks?.[0] as any)?.timestamp
    )
  })
})
