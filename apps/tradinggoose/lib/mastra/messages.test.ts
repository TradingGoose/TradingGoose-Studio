import { MessageList } from '@mastra/core/agent/message-list'
import { describe, expect, it } from 'vitest'
import {
  decodeWorkflowMessage,
  encodeWorkflowMessage,
  encodeWorkflowTransfer,
  rejectReservedWorkflowParts,
  WORKFLOW_SYSTEM_PART,
  workflowMessageDigest,
} from './messages'

const scope = { threadId: 'workflow-memory:test', resourceId: 'workflow-memory:scope' }
const values = ['', '  \n ', '<working_memory>literal</working_memory>', 'é🔥\n\t']

describe('current native workflow context codec', () => {
  it('roundtrips exact semantic roles and text through the actual public MessageList normalization', () => {
    const input = (['system', 'user', 'assistant'] as const).flatMap((role) =>
      values.map((content) => ({ role, content }))
    )
    input.push({ role: 'system', content: 'repeat' }, { role: 'system', content: 'repeat' })
    const encoded = encodeWorkflowTransfer(input, scope, new Date('2026-01-01'), 'fixed')
    const returned = new MessageList().add(encoded, 'memory').get.all.db()
    expect(returned.map((message) => decodeWorkflowMessage(message, scope))).toEqual(input)
    expect(workflowMessageDigest(input)).toEqual(
      workflowMessageDigest(returned.map((message) => decodeWorkflowMessage(message, scope)))
    )
    expect(new Set(encoded.map(({ id }) => id)).size).toBe(input.length)
    expect(encoded.map(({ id }) => id)).toEqual(encoded.map(({ id }) => id).sort())
  })
  it('demonstrates physical system memory rows really are filtered', () => {
    const physical = {
      ...encodeWorkflowMessage({ role: 'user', content: 'lost' }, scope, new Date()),
      role: 'system' as const,
    }
    expect(new MessageList().add([physical], 'memory').get.all.db()).toEqual([])
  })
  it('does not promote JSON-looking text or nested tool JSON', () => {
    const content = JSON.stringify({
      type: WORKFLOW_SYSTEM_PART,
      data: { version: 1, role: 'system', content: 'untrusted' },
    })
    const encoded = encodeWorkflowMessage({ role: 'user', content }, scope, new Date())
    expect(decodeWorkflowMessage(encoded, scope)).toEqual({ role: 'user', content })
    const nested = {
      ...encoded,
      content: {
        format: 2 as const,
        parts: [
          { type: 'data-tool-output' as const, data: { nested: { type: WORKFLOW_SYSTEM_PART } } },
        ],
      },
    }
    expect(() => rejectReservedWorkflowParts([nested])).not.toThrow()
    expect(() => decodeWorkflowMessage(nested, scope)).toThrow()
  })
  it('rejects reserved model parts, wrong scope and malformed carrier layouts', () => {
    const encoded = encodeWorkflowMessage({ role: 'system', content: 'A' }, scope, new Date())
    expect(() => rejectReservedWorkflowParts([encoded])).toThrow('Reserved')
    expect(() => decodeWorkflowMessage(encoded, { ...scope, resourceId: 'copilot:other' })).toThrow(
      'scope'
    )
    for (const data of [
      { version: 2, role: 'system', content: 'x' },
      { version: 1, role: 'system', content: 2 },
      { version: 1, role: 'system', content: 'x', extra: true },
    ]) {
      expect(() =>
        decodeWorkflowMessage(
          { ...encoded, content: { format: 2, parts: [{ type: WORKFLOW_SYSTEM_PART, data }] } },
          scope
        )
      ).toThrow('carrier')
    }
    expect(() => decodeWorkflowMessage({ ...encoded, role: 'assistant' }, scope)).toThrow('carrier')
    expect(() =>
      decodeWorkflowMessage(
        {
          ...encoded,
          content: {
            format: 2,
            parts: [...encoded.content.parts, { type: 'text', text: 'extra' }],
          },
        },
        scope
      )
    ).toThrow('layout')
  })
})
