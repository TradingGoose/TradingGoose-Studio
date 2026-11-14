'use client'

import type { ImagePart } from '@/lib/copilot/native/contract'
import type { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { projectNativeHistoryMessage } from './history'
import { resolveToolDisplay } from './tool-registry'
import type { ChatContext, CopilotMessage, CopilotStore } from './types'

type PlanTodo = CopilotStore['planTodos'][number]

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

    const seen = new Set<string>()
    for (const block of message.contentBlocks ?? []) {
      if (block.type !== 'tool_call' || !block.toolCall.id || seen.has(block.toolCall.id)) continue
      const toolCall = block.toolCall
      seen.add(toolCall.id)
      if (toolCall.state !== 'success') {
        continue
      }

      const result = isRecord(toolCall.result) ? toolCall.result : {}

      if (toolCall.name === 'plan') {
        const todoList = Array.isArray(result.todoList) ? result.todoList : null
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

      const todoItemId = readCanonicalStringId(result.id)
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

export function updateMessageToolCalls(
  messages: CopilotMessage[],
  toolCallsById: CopilotStore['toolCallsById']
): CopilotMessage[] {
  return messages.map((message) => {
    let changed = false
    const contentBlocks = message.contentBlocks?.map((block) => {
      if (block.type !== 'tool_call') return block
      const toolCall = toolCallsById[block.toolCall.id]
      if (!toolCall || toolCall === block.toolCall) return block
      changed = true
      return { ...block, toolCall }
    })
    return changed ? { ...message, contentBlocks } : message
  })
}

export function updateToolCallState(
  state: Pick<CopilotStore, 'messages' | 'toolCallsById'>,
  toolCallId: string,
  nextState: ClientToolCallState,
  result?: unknown
): Partial<Pick<CopilotStore, 'messages' | 'toolCallsById'>> {
  const current = state.toolCallsById[toolCallId]
  if (!current) return {}
  const toolCall = {
    ...current,
    state: nextState,
    display: resolveToolDisplay(current.name, nextState, current.params),
    ...(result !== undefined ? { result } : {}),
  }
  const toolCallsById = { ...state.toolCallsById, [toolCallId]: toolCall }
  return { toolCallsById, messages: updateMessageToolCalls(state.messages, toolCallsById) }
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

export function createStreamingMessage(id = crypto.randomUUID()): CopilotMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}
