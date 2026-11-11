import { describe, expect, it } from 'vitest'
import { buildAssistantMessageSegments } from './assistant-message-segments'

const thinking = (content: string) => ({
  type: 'thinking' as const,
  content,
  timestamp: 1,
})
const text = (content: string) => ({
  type: 'text' as const,
  content,
  timestamp: 1,
})

describe('buildAssistantMessageSegments', () => {
  it('groups consecutive thinking blocks and preserves text/tool order', () => {
    const segments = buildAssistantMessageSegments([
      thinking('Inspecting the workflow.'),
      thinking('Preparing the edit plan.'),
      thinking('   '),
      text('I found the workflow.'),
      {
        type: 'tool_call',
        timestamp: 1,
        toolCall: {
          id: 'tool-1',
          name: 'read_workflow',
          state: 'success' as any,
        },
      },
      text('I am ready to update it.'),
    ])

    expect(segments.map((segment) => segment.type)).toEqual([
      'thinking',
      'text',
      'tool_call',
      'text',
    ])

    expect(segments[0]).toMatchObject({
      type: 'thinking',
      blocks: [{ content: 'Inspecting the workflow.' }, { content: 'Preparing the edit plan.' }],
    })
  })

  it('creates a new thinking group after non-thinking content', () => {
    const segments = buildAssistantMessageSegments([
      thinking('First pass.'),
      text('Intermediate reply.'),
      thinking('Second pass.'),
    ])

    expect(segments.map((segment) => segment.type)).toEqual(['thinking', 'text', 'thinking'])
  })
  it('keeps native images between their original text and reasoning parts', () => {
    const image = {
      type: 'file' as const,
      timestamp: 1,
      file: {
        data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
      },
    }
    const segments = buildAssistantMessageSegments([
      thinking('before'),
      image,
      thinking('after'),
      text('tail'),
    ])
    expect(segments.map((segment) => segment.type)).toEqual([
      'thinking',
      'file',
      'thinking',
      'text',
    ])
    expect(segments[1]).toMatchObject({ type: 'file', block: image })
  })
})
