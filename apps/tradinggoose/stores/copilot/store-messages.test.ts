import { describe, expect, it } from 'vitest'
import { COPILOT_CONTEXT_PART } from '@/lib/copilot/native/contract'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { projectNativeHistory, projectNativeHistoryMessage } from './history'
import {
  buildPlanTodosFromMessages,
  createUserMessage,
  updateToolCallState,
} from './store-messages'
import type { CopilotMessage } from './types'

const at = '2026-11-08T00:00:00.000Z'
const native = (parts: any[], role: 'assistant' | 'user' | 'signal' = 'assistant') => ({
  id: 'message',
  role,
  createdAt: at,
  parts,
})
describe('canonical native history display', () => {
  it('restores mention locators from native UI data while preserving the original prompt', () => {
    const contexts = [
      { kind: 'workflow' as const, workflowId: 'workflow-id', label: 'My workflow' },
    ]
    const message = projectNativeHistoryMessage(
      native(
        [
          { type: 'text', text: 'Explain @My workflow' },
          { type: COPILOT_CONTEXT_PART, data: contexts },
        ],
        'user'
      )
    )!
    expect(message.content).toBe('Explain @My workflow')
    expect(message.contexts).toEqual(contexts)
    expect(message.contentBlocks).toEqual([
      { type: 'text', content: 'Explain @My workflow', timestamp: Date.parse(at) },
    ])
  })
  it('retains native message usage and cost without treating unknown amounts as zero', () => {
    const usage = { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
    const cost = {
      status: 'partial' as const,
      currency: 'USD',
      estimated: true,
      availableTotal: 0.002,
    }
    const message = projectNativeHistoryMessage({
      ...native([{ type: 'text', text: 'Known answer' }]),
      usage,
      cost,
    })!
    expect(message.usage).toEqual(usage)
    expect(message.cost).toEqual(cost)
    expect(message.cost).not.toHaveProperty('total')
  })
  it('preserves text bytes and explicit reasoning order without parsing user JSON as a control envelope', () => {
    const text = '{"reasoning":"business JSON","reply":"unchanged"}\n🦆'
    const message = projectNativeHistoryMessage(
      native([
        { type: 'text', text },
        { type: 'reasoning', reasoning: 'native reasoning', details: [] },
        { type: 'text', text: 'after' },
      ])
    )!
    expect(message.content).toBe(`${text}after`)
    expect(message.contentBlocks?.map((block) => block.type)).toEqual(['text', 'thinking', 'text'])
    expect(message.contentBlocks?.[1]).not.toHaveProperty('duration')
  })
  it.each(['partial-call', 'call', 'approval-requested', 'approval-responded'])(
    'renders historical %s without granting execution',
    (state) => {
      const message = projectNativeHistoryMessage(
        native([
          {
            type: 'tool-invocation',
            toolInvocation: {
              state,
              toolCallId: 'call',
              toolName: 'read_workflow',
              args: { workflowId: 'original' },
            },
          },
        ])
      )!
      expect(message.contentBlocks?.[0]).toMatchObject({
        type: 'tool_call',
        toolCall: { historical: true, state: 'aborted', params: { workflowId: 'original' } },
      })
      expect(message.contentBlocks?.[0]).not.toHaveProperty('pending')
    }
  )
  it('keeps native functional tool results, never provider metrics or opaque diagnostic carriers', () => {
    const message = projectNativeHistoryMessage(
      native([
        {
          type: 'tool-invocation',
          toolInvocation: {
            state: 'result',
            toolCallId: 'call',
            toolName: 'read_workflow',
            args: {},
            result: { cost: 'business-schema-value', tools: ['functional'] },
          },
          providerMetadata: { tokens: 999 },
        },
        { type: 'data-report', data: { usd: 123 } },
        { type: 'step-start' },
      ])
    )!
    expect(message.contentBlocks).toHaveLength(1)
    expect(message.contentBlocks?.[0]).toMatchObject({
      toolCall: { result: { cost: 'business-schema-value', tools: ['functional'] } },
    })
    expect(message).not.toHaveProperty('providerMetadata')
  })
  it('renders a genuine typed historical rejection without successful mutation or executable authority', () => {
    const result = { success: false, rejected: true, toolName: 'edit_workflow' }
    const message = projectNativeHistoryMessage(
      native([
        {
          type: 'tool-invocation',
          toolInvocation: {
            state: 'result',
            toolCallId: 'rejected',
            toolName: 'edit_workflow',
            args: { entityId: 'workflow' },
            result,
          },
        },
      ])
    )!
    expect(message.contentBlocks?.[0]).toMatchObject({
      toolCall: { state: ClientToolCallState.rejected, historical: true, result },
    })
    expect(message.contentBlocks?.[0]).not.toHaveProperty('pending')
  })
  it('preserves retained inline image bytes in canonical order without upload proofs or external fetches', () => {
    const file = {
      type: 'file',
      mimeType: 'image/png',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
    }
    const projected = projectNativeHistoryMessage(
      native(
        [{ type: 'text', text: ' before\n' }, file, { type: 'text', text: '\tafter ' }],
        'user'
      )
    )!
    expect(projected.contentBlocks).toEqual([
      { type: 'text', content: ' before\n', timestamp: Date.parse(at) },
      {
        type: 'file',
        file: { data: file.data, mimeType: file.mimeType },
        timestamp: Date.parse(at),
      },
      { type: 'text', content: '\tafter ', timestamp: Date.parse(at) },
    ])
    expect(projected.content).toBe(' before\n\tafter ')
    expect(projected).not.toHaveProperty('fileAttachments')
  })
  it('refuses malformed inline image and tool/history parts without inventing identities', () => {
    expect(() =>
      projectNativeHistoryMessage(
        native([{ type: 'file', mimeType: 'image/png', data: 'private' }])
      )
    ).toThrow('valid inline bytes')
    for (const part of [
      { type: 'file', mimeType: 'image/png', data: 'https://private.example/source' },
      {
        type: 'file',
        mimeType: 'image/jpeg',
        data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
      },
      { type: 'file', mimeType: 'image/png', data: 'data:image/png;base64,' },
    ])
      expect(() => projectNativeHistoryMessage(native([part]))).toThrow('valid inline bytes')
    expect(() =>
      projectNativeHistoryMessage(
        native([
          { type: 'tool-invocation', toolInvocation: { state: 'call', toolName: 'read_workflow' } },
        ])
      )
    ).toThrow('invalid')
    expect(() => projectNativeHistory([native([]), native([])])).toThrow('repeats')
    expect(projectNativeHistoryMessage(native([], 'signal'))).toBeNull()
  })
  it('keeps user mention locators on transient user messages only in the canonical contexts field', () => {
    const message = createUserMessage('Read @Docs', undefined, [{ kind: 'docs', label: 'Docs' }])
    expect(message.contexts).toEqual([{ kind: 'docs', label: 'Docs' }])
    expect(message.contentBlocks).toEqual([
      { type: 'text', content: 'Read @Docs', timestamp: Date.parse(message.timestamp) },
    ])
  })
  it('projects optimistic images through the same ordered native history parts', () => {
    const images = ['first', 'second'].map((text) => ({
      type: 'image' as const,
      image: `data:image/png;base64,${btoa(text)}`,
      mediaType: 'image/png',
    }))
    const message = createUserMessage('Look', images)
    expect(message).toEqual(
      projectNativeHistoryMessage({
        id: message.id,
        role: 'user',
        createdAt: message.timestamp,
        parts: [
          { type: 'text', text: 'Look' },
          ...images.map((image) => ({
            type: 'file' as const,
            data: image.image,
            mimeType: image.mediaType,
          })),
        ],
      })
    )
  })
  it('rebuilds plan/todo display in actual message order and resets it at the next user turn', () => {
    const message: CopilotMessage = {
      id: 'plan',
      role: 'assistant',
      timestamp: at,
      content: '',
      contentBlocks: [
        {
          type: 'tool_call',
          timestamp: 1,
          toolCall: {
            id: 'plan',
            name: 'plan',
            state: ClientToolCallState.success,
            result: {
              todoList: [
                { id: 'one', content: 'Inspect' },
                { id: 'two', content: 'Test' },
              ],
            },
          },
        },
        {
          type: 'tool_call',
          timestamp: 2,
          toolCall: {
            id: 'done',
            name: 'checkoff_todo',
            state: ClientToolCallState.success,
            result: { id: 'one' },
          },
        },
      ],
    }
    expect(buildPlanTodosFromMessages([message])).toEqual([
      { id: 'one', content: 'Inspect', completed: true, executing: false },
      { id: 'two', content: 'Test', completed: false, executing: false },
    ])
    expect(buildPlanTodosFromMessages([message, createUserMessage('Next')])).toEqual([])
    const plan = message.contentBlocks![0]
    if (plan.type !== 'tool_call') throw new Error('Expected plan tool call')
    const unrelated = createUserMessage('Unchanged')
    const updated = updateToolCallState(
      { messages: [message, unrelated], toolCallsById: { plan: plan.toolCall } },
      'plan',
      ClientToolCallState.error,
      { error: 'Planning failed' }
    )
    expect(updated.messages?.[0].contentBlocks?.[0]).toEqual({
      ...plan,
      toolCall: updated.toolCallsById?.plan,
    })
    expect(updated.toolCallsById?.plan).toMatchObject({
      state: 'error',
      display: { text: 'Failed to plan' },
      result: { error: 'Planning failed' },
    })
    expect(updated.messages?.[1]).toBe(unrelated)
    expect(updated.messages?.[0].contentBlocks?.[1]).toBe(message.contentBlocks![1])
  })
})
