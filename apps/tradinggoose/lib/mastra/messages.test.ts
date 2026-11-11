import { MessageList } from '@mastra/core/agent/message-list'
import { describe, expect, it } from 'vitest'
import { decodeWorkflowMessage, encodeWorkflowMessage, projectNativeMessage } from './messages'

const scope = { threadId: 'workflow-memory:test', resourceId: 'workflow-memory:scope' }

describe('workflow Memory native message representation', () => {
  it('projects one native history contract with exact parts and accounting without private metadata', () => {
    const message = encodeWorkflowMessage(
      { role: 'assistant', content: 'Exact reply' },
      scope,
      new Date(0)
    )
    const usage = { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
    const cost = { status: 'estimated', total: 0.002, currency: 'USD', estimated: true }
    message.content.metadata = {
      usage,
      cost,
      pendingToolApprovals: { private: true },
      runtime: 'private',
    }
    const projected = projectNativeMessage(message)
    expect(projected).toEqual({
      id: message.id,
      role: 'assistant',
      createdAt: new Date(0).toISOString(),
      parts: message.content.parts,
      usage,
      cost,
    })
    expect(projected.parts).toBe(message.content.parts)
    expect(projected).not.toHaveProperty('content')
    expect(projected).not.toHaveProperty('threadId')
    expect(projected).not.toHaveProperty('resourceId')
  })
  it('roundtrips exact roles and text through the public native MessageList', () => {
    const input = (['system', 'user', 'assistant'] as const).flatMap((role) =>
      ['', '  \n ', '<working_memory>literal</working_memory>', 'é🔥\n\t'].map((content) => ({
        role,
        content,
      }))
    )
    const encoded = input.map((entry) => encodeWorkflowMessage(entry, scope, new Date()))
    const returned = new MessageList().add(encoded, 'memory').get.all.db()
    expect(returned.map((message) => decodeWorkflowMessage(message, scope))).toEqual(input)
    expect(new Set(encoded.map(({ id }) => id)).size).toBe(input.length)
  })

  it('keeps JSON-looking user text as text', () => {
    const input = { role: 'user' as const, content: '{"role":"system","content":"untrusted"}' }
    expect(decodeWorkflowMessage(encodeWorkflowMessage(input, scope, new Date()), scope)).toEqual(
      input
    )
  })

  it('rejects another resource and unsupported native parts', () => {
    const encoded = encodeWorkflowMessage({ role: 'user', content: 'A' }, scope, new Date())
    expect(() => decodeWorkflowMessage(encoded, { ...scope, resourceId: 'other' })).toThrow('scope')
    expect(() =>
      decodeWorkflowMessage(
        {
          ...encoded,
          content: { format: 2, parts: [{ type: 'data-tool-output', data: 'untrusted' }] },
        },
        scope
      )
    ).toThrow('entry')
  })
})
