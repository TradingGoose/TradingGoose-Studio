import { attachWorkflowMessageSource, getWorkflowMessageSource } from './workflow-message-source'

export { copyWorkflowMessageSource, getWorkflowMessageSource } from './workflow-message-source'

import { createHash, randomUUID } from 'node:crypto'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'

export const WORKFLOW_SYSTEM_PART = 'data-workflow-system-message' as const
export type WorkflowMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type NativeMessageScope = { threadId: string; resourceId: string }

export const createWorkflowMessageId = () => `workflow-message:${randomUUID()}`

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

/** Only trusted workflow context writers may create this reserved top-level part. */
export function encodeWorkflowMessage(
  message: WorkflowMessage,
  scope: NativeMessageScope,
  createdAt: Date,
  id = createWorkflowMessageId()
): MastraDBMessage {
  if (
    !['system', 'user', 'assistant'].includes(message.role) ||
    typeof message.content !== 'string'
  )
    throw new Error('Invalid workflow Memory message')
  const source = getWorkflowMessageSource(message)
  return {
    id,
    ...scope,
    createdAt,
    role: message.role === 'system' ? 'user' : message.role,
    content: {
      format: 2,
      ...(source ? { metadata: { workflowSource: source } } : {}),
      parts:
        message.role === 'system'
          ? [
              {
                type: WORKFLOW_SYSTEM_PART,
                data: { version: 1, role: 'system', content: message.content },
              },
            ]
          : [{ type: 'text', text: message.content }],
    },
  }
}

/** Scope authorization must precede this exact current-format projection. */
export function decodeWorkflowMessage(
  message: MastraDBMessage,
  scope: NativeMessageScope
): WorkflowMessage {
  assertMessageScope(message, scope)
  const parts = message.content.parts
  if (parts.length !== 1) throw new Error('Invalid workflow Memory part layout')
  const part = parts[0]
  if (part.type === WORKFLOW_SYSTEM_PART) {
    const data = part.data as Record<string, unknown>
    if (
      message.role !== 'user' ||
      !data ||
      typeof data !== 'object' ||
      Object.keys(data).sort().join(',') !== 'content,role,version' ||
      data.version !== 1 ||
      data.role !== 'system' ||
      typeof data.content !== 'string'
    )
      throw new Error('Invalid workflow system carrier')
    const decoded = { role: 'system' as const, content: data.content }
    return scope.threadId.startsWith('workflow-memory:')
      ? attachWorkflowMessageSource(decoded, { messageId: message.id, ...scope })
      : decoded
  }
  if (
    (message.role !== 'user' && message.role !== 'assistant') ||
    part.type !== 'text' ||
    typeof part.text !== 'string'
  )
    throw new Error('Unrepresentable workflow Memory message')
  const decoded = { role: message.role, content: part.text }
  return scope.threadId.startsWith('workflow-memory:')
    ? attachWorkflowMessageSource(decoded, { messageId: message.id, ...scope })
    : decoded
}

export function assertMessageScope(message: MastraDBMessage, scope: NativeMessageScope): void {
  if (
    message.threadId !== scope.threadId ||
    message.resourceId !== scope.resourceId ||
    !message.id ||
    message.content?.format !== 2 ||
    !Array.isArray(message.content.parts) ||
    !Number.isFinite(new Date(message.createdAt).getTime())
  )
    throw new Error('Native workflow message scope or format mismatch')
}

/** Never promote a model/tool-authored extension part to trusted system instructions. */
export function rejectReservedWorkflowParts(messages: MastraDBMessage[]): void {
  if (
    messages.some((message) =>
      message.content.parts.some((part) => part.type === WORKFLOW_SYSTEM_PART)
    )
  )
    throw new Error('Reserved workflow system part is not accepted from model or tool output')
}

export function workflowMessageDigest(messages: WorkflowMessage[]): string {
  return createHash('sha256')
    .update(JSON.stringify(messages.map(({ role, content }) => [role, content])))
    .digest('hex')
}

/** Stable equal-time ordering without claiming historical per-message timestamps. */
export function encodeWorkflowTransfer(
  messages: WorkflowMessage[],
  scope: NativeMessageScope,
  createdAt: Date,
  prefix: string = randomUUID()
): MastraDBMessage[] {
  return messages.map((message, ordinal) =>
    encodeWorkflowMessage(
      message,
      scope,
      createdAt,
      `workflow-import:${prefix}:${String(ordinal).padStart(12, '0')}`
    )
  )
}
