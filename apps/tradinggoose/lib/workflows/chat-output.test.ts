import { describe, expect, it } from 'vitest'
import { createChatOutputEventReader } from './chat-output'

describe('createChatOutputEventReader', () => {
  it('treats empty selections as streamable content and errors by selected block', () => {
    const allOutputsReader = createChatOutputEventReader([])

    expect(
      allOutputsReader.readEvent({
        type: 'block:completed',
        data: { blockId: 'agent-1', output: { content: 'visible', summary: 'hidden' } },
      } as any)
    ).toEqual([{ type: 'content', blockId: 'agent-1', content: 'visible' }])

    const selectedReader = createChatOutputEventReader(['agent-1_summary'])

    expect(
      selectedReader.readEvent({
        type: 'block:error',
        data: { blockId: 'agent-1', error: 'Agent failed' },
      } as any)
    ).toEqual([{ type: 'error', blockId: 'agent-1', message: 'Agent failed' }])
  })
})
