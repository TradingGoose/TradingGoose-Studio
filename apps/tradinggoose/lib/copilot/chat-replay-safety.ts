import type { CopilotMessage } from '@/stores/copilot/types'

export const EDIT_REPLAY_BLOCKED_MESSAGE =
  'Start a new message after tool activity to preserve its history.'

/** Match native history.edit: removing any tool activity would invalidate its history. */
export function hasToolActivityAfterMessage(
  messages: CopilotMessage[],
  messageId: string
): boolean {
  const index = messages.findIndex((message) => message.id === messageId)
  return (
    index !== -1 &&
    messages
      .slice(index + 1)
      .some((message) => message.contentBlocks?.some((block) => block.type === 'tool_call'))
  )
}
