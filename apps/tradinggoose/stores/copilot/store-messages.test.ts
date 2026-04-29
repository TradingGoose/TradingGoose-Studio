import { describe, expect, it } from 'vitest'
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
})
