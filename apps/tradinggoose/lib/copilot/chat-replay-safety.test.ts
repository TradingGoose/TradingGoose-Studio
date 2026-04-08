import { describe, expect, it } from 'vitest'
import {
  dropsAcceptedLiveMutation,
  hasAcceptedLiveMutationAfterMessage,
  isAcceptedLiveMutationToolCall,
  messageHasAcceptedLiveMutation,
} from '@/lib/copilot/chat-replay-safety'

describe('chat replay safety', () => {
  it('recognizes accepted live mutation tool calls from tool state', () => {
    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-1',
        name: 'edit_workflow',
        state: 'success',
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-2',
        name: 'edit_workflow',
        state: 'accepted',
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-3',
        name: 'set_global_workflow_variables',
        state: 'success',
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-4',
        name: 'manage_skill',
        state: 'success',
        params: { operation: 'edit' },
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-5',
        name: 'manage_indicator',
        state: 'success',
        result: { operation: 'list' },
      })
    ).toBe(false)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-6',
        name: 'run_workflow',
        state: 'success',
      })
    ).toBe(false)
  })

  it('detects accepted live mutations from assistant message tool blocks', () => {
    expect(
      messageHasAcceptedLiveMutation({
        id: 'assistant-1',
        contentBlocks: [
          {
            type: 'tool_call',
            timestamp: 1,
            toolCall: {
              id: 'tool-1',
              name: 'edit_workflow',
              state: 'success',
            },
          },
        ],
      })
    ).toBe(true)

    expect(
      messageHasAcceptedLiveMutation({
        id: 'assistant-2',
        toolCalls: [
          {
            id: 'tool-2',
            name: 'manage_custom_tool',
            state: 'success',
            params: {
              operation: 'list',
            },
          },
        ],
      })
    ).toBe(false)
  })

  it('blocks replay only when a later accepted live mutation would be removed', () => {
    const messages = [
      {
        id: 'message-1',
        toolCalls: [],
      },
      {
        id: 'message-2',
        contentBlocks: [
          {
            type: 'tool_call',
            toolCall: {
              id: 'tool-1',
              name: 'manage_mcp_tool',
              state: 'success',
              result: {
                operation: 'edit',
              },
            },
          },
        ],
      },
      {
        id: 'message-3',
        toolCalls: [],
      },
    ]

    expect(hasAcceptedLiveMutationAfterMessage(messages, 'message-1')).toBe(true)
    expect(hasAcceptedLiveMutationAfterMessage(messages, 'message-2')).toBe(false)
    expect(
      dropsAcceptedLiveMutation(messages, [
        {
          id: 'message-1',
        },
      ])
    ).toBe(true)
    expect(
      dropsAcceptedLiveMutation(messages, [
        {
          id: 'message-1',
        },
        {
          id: 'message-2',
        },
      ])
    ).toBe(false)
  })
})
