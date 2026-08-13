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

  it('preserves structured deadline diagnostics on terminal errors', () => {
    const reader = createChatOutputEventReader([])
    const result = {
      success: false,
      output: {},
      error: 'persisted English deadline error',
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      deadline: {
        appliedTierId: 'tier-pro',
        appliedTierName: 'Pro',
        limitSeconds: 20,
        processingStartedAt: '2026-08-07T15:16:14.200Z',
        terminatedAt: '2026-08-07T15:16:34.200Z',
      },
      logs: [],
    }

    expect(
      reader.readEvent({
        type: 'execution:error',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timestamp: '2026-08-07T15:16:34.200Z',
        data: { error: result.error, result },
      })
    ).toEqual([
      {
        type: 'error',
        blockId: 'workflow',
        message: result.error,
        result,
      },
    ])
  })
})
