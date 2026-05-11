import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  traverseObjectPath,
} from '@/lib/response-format'
import type { BlockLog, ExecutionResult } from '@/executor/types'

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

export function canStreamSelectedBlock(selectedOutputs: string[], blockId: string) {
  if (selectedOutputs.length === 0) return true
  return selectedOutputsForBlock(selectedOutputs, blockId).some((outputId) =>
    isStreamedOutput(outputId, blockId)
  )
}

export function resolveSelectedBlockOutput(params: {
  blockId: string
  output: unknown
  selectedOutputs: string[]
  skipStreamedOutput?: boolean
}) {
  if (params.selectedOutputs.length === 0) {
    return params.skipStreamedOutput ? '' : formatChatOutputContent(params.output)
  }

  return selectedOutputsForBlock(params.selectedOutputs, params.blockId)
    .filter((outputId) => !params.skipStreamedOutput || !isStreamedOutput(outputId, params.blockId))
    .map((outputId) => {
      const path = extractPathFromOutputId(outputId, params.blockId)
      const value = path ? traverseObjectPath(params.output, path) : params.output
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

      const value = path ? traverseObjectPath(log.output, path) : log.output
      return formatChatOutputContent(value)
    })
    .filter(Boolean)
    .join('\n\n')
}

export function resolveExecutionResultChatOutput(
  result: ExecutionResult,
  selectedOutputs: string[]
) {
  return selectedOutputs.length
    ? resolveSelectedChatOutput(result, selectedOutputs)
    : formatChatOutputContent(result.output)
}
