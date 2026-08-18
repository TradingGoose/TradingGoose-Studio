import { describe, expect, it } from 'vitest'
import { buildAssistantMessageSegments } from './assistant-message-segments'

const thinking = (itemId: string, content: string) => ({
  type: 'thinking' as const,
  content,
  timestamp: 1,
  itemId,
})
const text = (itemId: string, content: string) => ({
  type: 'text' as const,
  content,
  timestamp: 1,
  itemId,
})

describe('buildAssistantMessageSegments', () => {
  it('groups consecutive thinking blocks and preserves text/tool order', () => {
    const segments = buildAssistantMessageSegments([
      thinking('thinking-1', 'Inspecting the workflow.'),
      thinking('thinking-2', 'Preparing the edit plan.'),
      thinking('empty-thinking', '   '),
      text('text-1', 'I found the workflow.'),
      {
        type: 'tool_call',
        timestamp: 1,
        toolCall: {
          id: 'tool-1',
          name: 'read_workflow',
          state: 'success' as any,
        },
      },
      text('text-2', 'I am ready to update it.'),
    ])

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
      thinking('thinking-1', 'First pass.'),
      text('text-1', 'Intermediate reply.'),
      thinking('thinking-2', 'Second pass.'),
    ])

    expect(segments.map((segment) => segment.type)).toEqual(['thinking', 'text', 'thinking'])
  })
})
