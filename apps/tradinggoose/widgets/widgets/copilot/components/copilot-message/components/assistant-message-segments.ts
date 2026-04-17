import type { CopilotMessage } from '@/stores/copilot/types'

type AssistantContentBlock = NonNullable<CopilotMessage['contentBlocks']>[number]
type ThinkingContentBlock = Extract<AssistantContentBlock, { type: 'thinking' }>
type TextContentBlock = Extract<AssistantContentBlock, { type: 'text' }>
type ToolCallContentBlock = Extract<AssistantContentBlock, { type: 'tool_call' }>

export type AssistantMessageSegment =
  | {
      type: 'thinking'
      key: string
      blocks: ThinkingContentBlock[]
    }
  | {
      type: 'text'
      key: string
      block: TextContentBlock
    }
  | {
      type: 'tool_call'
      key: string
      block: ToolCallContentBlock
    }

export function buildAssistantMessageSegments(
  contentBlocks?: CopilotMessage['contentBlocks']
): AssistantMessageSegment[] {
  if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
    return []
  }

  const segments: AssistantMessageSegment[] = []
  let pendingThinkingBlocks: ThinkingContentBlock[] = []

  const flushThinkingGroup = () => {
    if (pendingThinkingBlocks.length === 0) {
      return
    }

    const firstBlock = pendingThinkingBlocks[0]
    const lastBlock = pendingThinkingBlocks[pendingThinkingBlocks.length - 1]
    segments.push({
      type: 'thinking',
      key: `thinking-${firstBlock.itemId ?? firstBlock.timestamp}-${lastBlock.itemId ?? lastBlock.timestamp}`,
      blocks: pendingThinkingBlocks,
    })
    pendingThinkingBlocks = []
  }

  for (const block of contentBlocks) {
    if (block.type === 'thinking') {
      pendingThinkingBlocks.push(block)
      continue
    }

    flushThinkingGroup()

    if (block.type === 'text') {
      segments.push({
        type: 'text',
        key: `text-${block.itemId ?? block.timestamp}`,
        block,
      })
      continue
    }

    if (block.type === 'tool_call') {
      segments.push({
        type: 'tool_call',
        key: `tool-${block.toolCall.id}`,
        block,
      })
    }
  }

  flushThinkingGroup()

  return segments
}
