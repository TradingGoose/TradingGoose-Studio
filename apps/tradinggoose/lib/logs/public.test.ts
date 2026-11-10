import { describe, expect, it } from 'vitest'
import { publicTraceSpans } from './public'
import type { TraceSpan } from './types'

describe('public Records and terminal event projection', () => {
  it('removes private native reference envelopes recursively without erasing intentional structured business names', () => {
    const nested = {
      model: 'schema model',
      tokens: 9,
      cost: { business: true },
      inference: { nativePayload: 'ordinary user JSON' },
    }
    const span: TraceSpan = {
      id: 'a',
      name: 'Agent',
      type: 'agent',
      blockId: 'a',
      duration: 1,
      startTime: 'start',
      endTime: 'end',
      output: nested,
      inference: {
        model: 'native/model',
        generatedFields: [],
        nativePayload: {
          version: 1,
          purpose: 'workflow-agent',
          workspaceId: 'w',
          executionId: 'e',
          logId: 'l',
          blockId: 'a',
          runId: 'r',
          threadId: 'private-thread',
          resourceId: 'private-resource',
          messageIds: ['private-id'],
          digest: 'digest',
        },
      },
      children: [],
    }
    span.children = [{ ...span, id: 'child', children: [] }]
    const visible = publicTraceSpans([span])
    expect(visible[0]).not.toHaveProperty('inference')
    expect(visible[0].children?.[0]).not.toHaveProperty('inference')
    expect(visible[0].output).toEqual(nested)
    expect(JSON.stringify(visible)).not.toContain('private-thread')
    expect(span.inference).toBeDefined()
  })
})
