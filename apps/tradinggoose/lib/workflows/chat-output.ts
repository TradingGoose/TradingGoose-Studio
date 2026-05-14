import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  traverseObjectPath,
} from '@/lib/response-format'
import type { WorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import { isExecutionResult } from '@/lib/workflows/execution-result'
import type { BlockLog, ExecutionResult } from '@/executor/types'

type ChatOutputEvent =
  | { type: 'content'; blockId: string; content: string }
  | { type: 'error'; blockId: string; message: string }
  | { type: 'final'; success: boolean; result: ExecutionResult }

function formatChatOutputContent(value: unknown) {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return JSON.stringify(value, null, 2)
}

function selectedOutputsForBlock(selectedOutputs: string[], blockId: string) {
  return selectedOutputs.filter((outputId) => extractBlockIdFromOutputId(outputId) === blockId)
}

function isStreamedOutput(outputId: string, blockId: string) {
  const path = extractPathFromOutputId(outputId, blockId)
  return !path || path === 'content'
}

function resolveChatOutputPath(output: unknown, path: string) {
  const value = traverseObjectPath(output, path)
  if (value !== undefined || path.startsWith('response.')) return value
  return traverseObjectPath(output, `response.${path}`)
}

function canStreamSelectedBlock(selectedOutputs: string[], blockId: string) {
  if (selectedOutputs.length === 0) return true
  return selectedOutputsForBlock(selectedOutputs, blockId).some((outputId) =>
    isStreamedOutput(outputId, blockId)
  )
}

function resolveStreamableBlockOutput(output: unknown) {
  if (typeof output === 'string') return output
  return formatChatOutputContent(resolveChatOutputPath(output, 'content'))
}

function resolveSelectedBlockOutput(params: {
  blockId: string
  output: unknown
  selectedOutputs: string[]
  skipStreamedOutput?: boolean
}) {
  if (params.selectedOutputs.length === 0) {
    return params.skipStreamedOutput ? '' : resolveStreamableBlockOutput(params.output)
  }

  return selectedOutputsForBlock(params.selectedOutputs, params.blockId)
    .filter((outputId) => !params.skipStreamedOutput || !isStreamedOutput(outputId, params.blockId))
    .map((outputId) => {
      const path = extractPathFromOutputId(outputId, params.blockId)
      const value = path ? resolveChatOutputPath(params.output, path) : params.output
      return formatChatOutputContent(value)
    })
    .filter(Boolean)
    .join('\n\n')
}

function resolveSelectedChatOutput(result: ExecutionResult, selectedOutputs: string[]) {
  return selectedOutputs
    .map((outputId) => {
      const blockId = extractBlockIdFromOutputId(outputId)
      const path = extractPathFromOutputId(outputId, blockId)
      const log = result.logs?.find((entry: BlockLog) => entry.blockId === blockId)
      if (!log) return ''

      const value = path ? resolveChatOutputPath(log.output, path) : log.output
      return formatChatOutputContent(value)
    })
    .filter(Boolean)
    .join('\n\n')
}

function resolveExecutionResultChatOutput(result: ExecutionResult, selectedOutputs: string[]) {
  if (selectedOutputs.length) return resolveSelectedChatOutput(result, selectedOutputs)
  return resolveStreamableBlockOutput(result.output)
}

export function createChatOutputEventReader(selectedOutputs: string[]) {
  let emittedContent = false
  const streamedBlocks = new Set<string>()

  const contentEvents = (blockId: string, content: string, separate = false): ChatOutputEvent[] => {
    if (!content) return []
    const nextContent = separate && emittedContent ? `\n\n${content}` : content
    emittedContent = true
    return [{ type: 'content', blockId, content: nextContent }]
  }

  return {
    hasEmittedContent: () => emittedContent,
    readEvent: (event: WorkflowExecutionEvent): ChatOutputEvent[] => {
      if (event.type === 'stream:chunk') {
        if (!canStreamSelectedBlock(selectedOutputs, event.data.blockId)) return []
        streamedBlocks.add(event.data.blockId)
        return contentEvents(event.data.blockId, event.data.chunk)
      }

      if (event.type === 'block:completed') {
        if (
          selectedOutputs.length > 0 &&
          selectedOutputsForBlock(selectedOutputs, event.data.blockId).length === 0
        ) {
          return []
        }
        const content = resolveSelectedBlockOutput({
          blockId: event.data.blockId,
          output: event.data.output,
          selectedOutputs,
          skipStreamedOutput: streamedBlocks.has(event.data.blockId),
        })
        return contentEvents(event.data.blockId, content, true)
      }

      if (event.type === 'block:error') {
        return selectedOutputs.length === 0 ||
          selectedOutputsForBlock(selectedOutputs, event.data.blockId).length > 0
          ? [
              {
                type: 'error',
                blockId: event.data.blockId,
                message: event.data.error || 'Block execution failed',
              },
            ]
          : []
      }

      if (event.type === 'execution:error') {
        return [
          {
            type: 'error',
            blockId: 'workflow',
            message: event.data.error || 'Workflow execution failed',
          },
        ]
      }

      if (event.type === 'execution:cancelled') {
        return [
          {
            type: 'error',
            blockId: 'workflow',
            message: 'Workflow execution was cancelled',
          },
        ]
      }

      if (event.type === 'execution:completed') {
        const result = event.data.result
        if (!isExecutionResult(result)) {
          return [
            {
              type: 'error',
              blockId: 'workflow',
              message: 'Chat workflow execution result is missing',
            },
          ]
        }

        const resultEvents = emittedContent
          ? []
          : contentEvents('workflow', resolveExecutionResultChatOutput(result, selectedOutputs))
        return [...resultEvents, { type: 'final' as const, success: result.success, result }]
      }

      return []
    },
  }
}
