import { createHash, randomUUID } from 'node:crypto'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'

export const WORKFLOW_SYSTEM_PART = 'data-workflow-system-message' as const
export type WorkflowMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type NativeMessageScope = { threadId: string; resourceId: string }

export function workflowMemoryIdentity(workspaceId: string, workflowId: string, key: string) {
  return {
    resourceId: `workflow-memory:${createHash('sha256')
      .update(JSON.stringify([workspaceId, workflowId]))
      .digest('hex')}`,
    threadId: `workflow-memory:${createHash('sha256')
      .update(JSON.stringify([workspaceId, workflowId, key]))
      .digest('hex')}`,
    metadata: { purpose: 'workflow-memory', workspaceId, workflowId, key, type: 'agent' },
  }
}

/** Mastra stores user/assistant rows; a native data part preserves an explicit system entry. */
export function encodeWorkflowMessage(
  message: WorkflowMessage,
  scope: NativeMessageScope,
  createdAt: Date,
  id = `workflow-message:${randomUUID()}`
): MastraDBMessage {
  return {
    id,
    ...scope,
    createdAt,
    role: message.role === 'system' ? 'user' : message.role,
    content: {
      format: 2,
      parts:
        message.role === 'system'
          ? [{ type: WORKFLOW_SYSTEM_PART, data: message.content }]
          : [{ type: 'text', text: message.content }],
    },
  }
}

export function decodeWorkflowMessage(
  message: MastraDBMessage,
  scope: NativeMessageScope
): WorkflowMessage {
  if (message.threadId !== scope.threadId || message.resourceId !== scope.resourceId)
    throw new Error('Workflow Memory scope mismatch')
  if (message.content.parts.length !== 1) throw new Error('Invalid workflow Memory entry')
  const part = message.content.parts[0]
  if (
    message.role === 'user' &&
    part.type === WORKFLOW_SYSTEM_PART &&
    typeof part.data === 'string'
  )
    return { role: 'system', content: part.data }
  if ((message.role === 'user' || message.role === 'assistant') && part.type === 'text')
    return { role: message.role, content: part.text }
  throw new Error('Invalid workflow Memory entry')
}
