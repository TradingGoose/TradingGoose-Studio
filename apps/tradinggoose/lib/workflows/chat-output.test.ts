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

  it('shows the review link while preserving paused status in the chat final result', () => {
    const reader = createChatOutputEventReader(['agent-1_content'])
    const result = {
      success: true,
      status: 'paused' as const,
      output: { url: '/review', revision: 2 },
      logs: [],
    }
    expect(
      reader.readEvent({
        type: 'execution:paused',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timestamp: new Date().toISOString(),
        data: { result },
      })
    ).toEqual([
      { type: 'content', blockId: 'workflow', content: 'Workflow is paused for review: /review' },
      { type: 'final', success: true, result },
    ])
  })
})
