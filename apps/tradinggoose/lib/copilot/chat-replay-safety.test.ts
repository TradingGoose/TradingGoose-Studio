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
        name: 'edit_workflow_block',
        state: 'success',
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-3b',
        name: 'set_workflow_variables',
        state: 'success',
      })
    ).toBe(true)

    for (const name of [
      'create_skill',
      'edit_skill',
      'create_custom_tool',
      'edit_custom_tool',
      'create_indicator',
      'edit_indicator',
      'create_mcp_server',
      'edit_mcp_server',
    ]) {
      expect(
        isAcceptedLiveMutationToolCall({
          id: `tool-${name}`,
          name,
          state: 'success',
        })
      ).toBe(true)
    }

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-5',
        name: 'edit_monitor',
        state: 'success',
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-5b',
        name: 'rename_workflow',
        state: 'accepted',
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-5c',
        name: 'set_environment_variables',
        state: 'success',
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-5d',
        name: 'deploy_workflow',
        state: 'success',
      })
    ).toBe(true)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-6',
        name: 'list_indicators',
        state: 'success',
      })
    ).toBe(false)

    expect(
      isAcceptedLiveMutationToolCall({
        id: 'tool-7',
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
            name: 'list_custom_tools',
            state: 'success',
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
              name: 'rename_mcp_server',
              state: 'success',
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
