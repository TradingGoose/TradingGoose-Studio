import { describe, expect, it } from 'vitest'
import { buildAssistantMessageSegments } from './assistant-message-segments'

describe('buildAssistantMessageSegments', () => {
  it('groups consecutive thinking blocks and preserves text/tool order', () => {
    const segments = buildAssistantMessageSegments([
      {
        type: 'thinking',
        content: 'Inspecting the workflow.',
        timestamp: 1,
        itemId: 'thinking-1',
        duration: 1200,
        startTime: 10,
      },
      {
        type: 'thinking',
        content: 'Preparing the edit plan.',
        timestamp: 2,
        itemId: 'thinking-2',
        duration: 800,
        startTime: 20,
      },
      {
        type: 'text',
        content: 'I found the workflow.',
        timestamp: 3,
        itemId: 'text-1',
      },
      {
        type: 'tool_call',
        timestamp: 4,
        toolCall: {
          id: 'tool-1',
          name: 'get_user_workflow',
          state: 'success' as any,
        },
      },
      {
        type: 'text',
        content: 'I am ready to update it.',
        timestamp: 5,
        itemId: 'text-2',
      },
    ])

    expect(segments).toHaveLength(4)
    expect(segments.map((segment) => segment.type)).toEqual([
      'thinking',
      'text',
      'tool_call',
      'text',
    ])

    expect(segments[0]).toMatchObject({
      type: 'thinking',
      blocks: [
        { itemId: 'thinking-1', content: 'Inspecting the workflow.' },
        { itemId: 'thinking-2', content: 'Preparing the edit plan.' },
      ],
    })
  })

  it('creates a new thinking group after non-thinking content', () => {
    const segments = buildAssistantMessageSegments([
      {
        type: 'thinking',
        content: 'First pass.',
        timestamp: 1,
        itemId: 'thinking-1',
      },
      {
        type: 'text',
        content: 'Intermediate reply.',
        timestamp: 2,
        itemId: 'text-1',
      },
      {
        type: 'thinking',
        content: 'Second pass.',
        timestamp: 3,
        itemId: 'thinking-2',
      },
    ])

    expect(segments.map((segment) => segment.type)).toEqual(['thinking', 'text', 'thinking'])
  })
})
