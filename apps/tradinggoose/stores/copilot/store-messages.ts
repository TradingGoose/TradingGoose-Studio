'use client'

import type { ImagePart } from '@/lib/copilot/native/contract'
import { projectNativeHistoryMessage } from './history'
import { resolveToolDisplay } from './tool-registry'
import type { ChatContext, CopilotMessage, CopilotStore, CopilotToolCall } from './types'

type PlanTodo = CopilotStore['planTodos'][number]

function readToolCallsInMessageOrder(message: CopilotMessage): CopilotToolCall[] {
  const toolCalls: CopilotToolCall[] = []
  const seenToolCallIds = new Set<string>()
  const appendToolCall = (toolCall: CopilotToolCall | undefined) => {
    if (!toolCall?.id || seenToolCallIds.has(toolCall.id)) {
      return
    }

    seenToolCallIds.add(toolCall.id)
    toolCalls.push(toolCall)
  }

  for (const block of message.contentBlocks ?? []) {
    if (block.type === 'tool_call' && block.toolCall) {
      appendToolCall(block.toolCall)
    }
  }

  return toolCalls
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readCanonicalStringId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function buildPlanTodosFromMessages(messages: CopilotMessage[]): PlanTodo[] {
  let todos: PlanTodo[] = []

  for (const message of messages) {
    if (message.role === 'user') todos = []

    for (const toolCall of readToolCallsInMessageOrder(message)) {
      if (toolCall.state !== 'success') {
        continue
      }

      const args = toolCall.params ?? {}
      const result = isRecord(toolCall.result) ? toolCall.result : {}

      if (toolCall.name === 'plan') {
        const todoList = Array.isArray(result.todoList)
          ? result.todoList
          : Array.isArray(args.todoList)
            ? args.todoList
            : null
        if (todoList) {
          todos = todoList
            .map<PlanTodo | null>((item: unknown, index: number) => {
              const itemRecord = isRecord(item) ? item : null
              const content =
                typeof item === 'string'
                  ? item.trim()
                  : typeof itemRecord?.content === 'string'
                    ? itemRecord.content.trim()
                    : ''
              return content
                ? {
                    id: readCanonicalStringId(itemRecord?.id) ?? `todo-${index}`,
                    content,
                    completed: itemRecord?.completed === true,
                    executing: itemRecord?.executing === true,
                  }
                : null
            })
            .filter((todo): todo is PlanTodo => !!todo)
        }
        continue
      }

      const todoItemId = readCanonicalStringId(result.id) ?? readCanonicalStringId(args.id)
      if (!todoItemId) {
        continue
      }

      if (toolCall.name === 'mark_todo_in_progress') {
        todos = todos.map((todo) =>
          todo.id === todoItemId ? { ...todo, completed: false, executing: true } : todo
        )
      } else if (toolCall.name === 'checkoff_todo') {
        todos = todos.map((todo) =>
          todo.id === todoItemId ? { ...todo, completed: true, executing: false } : todo
        )
      }
    }
  }

  return todos
}

export function updateMessagesForToolCallState(
  messages: CopilotMessage[],
  toolCallId: string,
  nextState: any,
  options?: { result?: any }
): CopilotMessage[] {
  let found = false
  const result: CopilotMessage[] = new Array(messages.length)
  for (let i = 0; i < messages.length; i++) {
    if (found) {
      result[i] = messages[i]
      continue
    }

    const message = messages[i]
    if (message.role !== 'assistant') {
      result[i] = message
      continue
    }

    let blocksChanged = false
    const contentBlocks = Array.isArray(message.contentBlocks)
      ? message.contentBlocks.map((block: any) => {
          if (block?.type !== 'tool_call' || block.toolCall?.id !== toolCallId) {
            return block
          }

          blocksChanged = true
          return {
            ...block,
            toolCall: {
              ...block.toolCall,
              state: nextState,
              display: resolveToolDisplay(block.toolCall?.name, nextState, block.toolCall?.params),
              ...(options?.result !== undefined ? { result: options.result } : {}),
            },
          }
        })
      : message.contentBlocks

    if (!blocksChanged) {
      result[i] = message
      continue
    }

    found = true
    result[i] = {
      ...message,
      ...(contentBlocks ? { contentBlocks } : {}),
    }
  }
  return result
}

export function createUserMessage(
  content: string,
  images?: ImagePart[],
  contexts?: ChatContext[],
  messageId?: string
): CopilotMessage {
  return {
    ...projectNativeHistoryMessage({
      id: messageId || crypto.randomUUID(),
      role: 'user',
      createdAt: new Date().toISOString(),
      parts: [
        { type: 'text', text: content },
        ...(images ?? []).map((image) => ({
          type: 'file' as const,
          data: image.image,
          mimeType: image.mediaType,
        })),
      ],
    })!,
    ...(contexts?.length && { contexts }),
  }
}

export function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}
