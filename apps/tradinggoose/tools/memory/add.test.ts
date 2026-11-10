import { describe, expect, it } from 'vitest'
import { workflowMessageDigest } from '@/lib/mastra/messages'
import { memoryAddTool } from './add'
import { memoryDeleteTool } from './delete'
import { memoryGetTool } from './get'
import { memoryGetAllTool } from './get_all'

const buildBody = memoryAddTool.request.body!

describe('Memory Add canonical request', () => {
  it('uses only the trusted workflow scope and agent type', () => {
    expect(
      buildBody({
        id: 'conversation-1',
        role: 'user',
        content: 'Hello',
        workflowId: 'untrusted',
        type: 'raw',
        workspaceId: 'untrusted',
        _context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
      })
    ).toEqual({
      key: 'conversation-1',
      type: 'agent',
      workflowId: 'workflow-1',
      data: { role: 'user' as const, content: 'Hello' },
    })
    expect(memoryAddTool.execution?.workspace).toEqual({ required: true, access: 'write' })
    expect(memoryAddTool.params.id.required).toBe(true)
    expect(memoryAddTool.params).not.toHaveProperty('conversationId')
  })

  it('rejects missing workflow context and missing identifiers', () => {
    expect(() => buildBody({ id: 'chat', workflowId: 'untrusted' })).toThrow(
      'workflowId is required'
    )
    expect(() => buildBody({ _context: { workflowId: 'workflow-1' } })).toThrow('id is required')
  })

  it('exposes the persisted message array from create and append responses', async () => {
    for (const status of [201, 200]) {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi' },
      ]
      const response = Response.json(
        {
          success: true,
          data: {
            id: 'workflow-memory:thread',
            workflowId: 'workflow',
            key: 'chat',
            data: messages,
            sourceRefs: messages.map((message, index) => ({
              messageId: `message-${index}`,
              ordinal: index,
              threadId: 'workflow-memory:thread',
              resourceId: 'workflow-memory:resource',
              digest: workflowMessageDigest([message]),
              readProof: {
                version: 1 as const,
                workspaceId: 'workspace',
                workflowId: 'workflow',
                key: 'chat',
                digest: workflowMessageDigest([message]),
              },
            })),
          },
        },
        { status }
      )
      expect(await memoryAddTool.transformResponse!(response)).toEqual({
        success: true,
        output: { memories: messages },
      })
    }
  })

  it.each([memoryGetTool, memoryDeleteTool, memoryGetAllTool])(
    '$id requires trusted workflow context and escapes URL identifiers',
    (tool) => {
      const url = tool.request.url
      if (typeof url !== 'function') throw new Error('Expected a URL builder')
      expect(() => url({ id: 'chat', workflowId: 'untrusted' })).toThrow('workflowId is required')
      expect(url({ id: 'chat/1', _context: { workflowId: 'workflow?1' } })).toBe(
        `/api/memory${tool === memoryGetAllTool ? '' : '/chat%2F1'}?workflowId=workflow%3F1`
      )
    }
  )

  it('reads canonical Get and Get All response envelopes', async () => {
    const data = [{ role: 'user' as const, content: 'Hello' }]
    const record = {
      id: 'workflow-memory:thread',
      workflowId: 'workflow',
      key: 'chat',
      type: 'agent',
      data,
      sourceRefs: data.map((message, index) => ({
        messageId: `message-${index}`,
        ordinal: index,
        threadId: 'workflow-memory:thread',
        resourceId: 'workflow-memory:resource',
        digest: workflowMessageDigest([message]),
        readProof: {
          version: 1 as const,
          workspaceId: 'workspace',
          workflowId: 'workflow',
          key: 'chat',
          digest: workflowMessageDigest([message]),
        },
      })),
    }
    expect(
      (await memoryGetTool.transformResponse!(Response.json({ success: true, data: record })))
        .output.memories
    ).toEqual(data)
    expect(
      (
        await memoryGetAllTool.transformResponse!(
          Response.json({ success: true, data: { memories: [record] } })
        )
      ).output.memories
    ).toEqual([{ key: 'chat', type: 'agent', data }])
  })
})
