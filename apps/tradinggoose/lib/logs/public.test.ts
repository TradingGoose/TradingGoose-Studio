import { describe, expect, it } from 'vitest'
import { publicTraceSpans } from './public'
import type { TraceSpan } from './types'

describe('public Records and terminal event projection', () => {
  it('removes internal inference metadata while retaining native history and structured outputs', () => {
    const nested = {
      model: 'schema model',
      tokens: 9,
      cost: { business: true },
      inference: { history: 'ordinary user JSON' },
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
      agentHistory: [
        {
          id: 'message',
          threadId: 'private-thread',
          resourceId: 'private-resource',
          role: 'assistant',
          createdAt: new Date(),
          content: { format: 2, parts: [{ type: 'text', text: 'Canonical Agent output' }] },
        },
      ],
      inference: {
        model: 'native/model',
        generatedFields: [],
        history: { runId: 'r', threadId: 'private-thread', resourceId: 'private-resource' },
      },
      children: [],
    }
    span.children = [{ ...span, id: 'child', children: [] }]
    const visible = publicTraceSpans([span])
    expect(visible[0]).not.toHaveProperty('inference')
    expect(visible[0].children?.[0]).not.toHaveProperty('inference')
    expect(visible[0].output).toEqual(nested)
    expect(visible[0].agentHistory).toEqual(span.agentHistory)
    expect(span.inference).toBeDefined()
  })
})
