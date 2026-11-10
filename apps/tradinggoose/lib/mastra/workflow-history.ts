import { createHash } from 'node:crypto'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { checkpointFunctionalOutput } from '@/executor/checkpoint'
import { assertOccurrenceIds } from '@/executor/types'
import { projectNativeMessagePart } from './errors'
import { lockMemoryMessageIds, type MemoryTransaction } from './memory-locks'
import {
  createWorkflowMessageId,
  decodeWorkflowMessage,
  encodeWorkflowMessage,
  rejectReservedWorkflowParts,
  type WorkflowMessage,
} from './messages'
import { getNativeMemory, getNativeMemoryStore } from './runtime'

export type FunctionalPayloadScope = {
  workspaceId: string
  executionId: string
  logId: string
  blockId: string
  runId: string
  actorUserId?: string
}
export type NativePayloadRef = Omit<FunctionalPayloadScope, 'actorUserId'> & {
  version: 1
  purpose: 'workflow-agent'
  resourceId: string
  threadId: string
  messageIds: string[]
  digest: string
}
export type FunctionalPayload = {
  selectedMessages?: WorkflowMessage[]
  messages?: MastraDBMessage[]
  output?: unknown
  tools?: unknown
  toolResultIndexes?: number[]
  blocks?: unknown[]
}
const FUNCTIONAL_PART = 'data-workflow-functional-payload' as const
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function workflowAgentPayloadResource(
  scope: Pick<FunctionalPayloadScope, 'workspaceId' | 'executionId' | 'logId'>
) {
  return `workflow-agent:${digest([scope.workspaceId, scope.executionId, scope.logId])}`
}
function identity(scope: FunctionalPayloadScope) {
  for (const field of ['workspaceId', 'executionId', 'logId', 'blockId', 'runId'] as const)
    if (typeof scope[field] !== 'string' || !scope[field])
      throw new Error('Missing trusted workflow payload scope')
  const { workspaceId, executionId, logId, blockId, runId } = scope
  return {
    version: 1 as const,
    purpose: 'workflow-agent' as const,
    workspaceId,
    executionId,
    logId,
    blockId,
    runId,
    resourceId: workflowAgentPayloadResource(scope),
    threadId: `workflow-agent:${digest([workspaceId, executionId, logId, blockId, runId])}`,
  }
}

async function assertOwner(scope: FunctionalPayloadScope, owner: MemoryTransaction = db) {
  const [row] = await owner
    .select({ executionData: workflowExecutionLogs.executionData })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.id, scope.logId),
        eq(workflowExecutionLogs.workspaceId, scope.workspaceId),
        eq(workflowExecutionLogs.executionId, scope.executionId)
      )
    )
    .limit(1)
  if (!row) throw new Error('Workflow payload owning execution is unavailable')
  if (scope.actorUserId && (row.executionData as any)?.environment?.userId !== scope.actorUserId)
    throw new Error('Workflow payload actor does not own the invocation')
}

function functionalMessage(
  message: MastraDBMessage,
  scope: ReturnType<typeof identity>,
  createdAt: Date
): MastraDBMessage {
  const { metadata: _metadata, ...content } = message.content
  // Keep nested business args/results verbatim; remove only native diagnostic envelopes.
  const parts = content.parts.map(projectNativeMessagePart)
  return {
    id: createWorkflowMessageId(),
    threadId: scope.threadId,
    resourceId: scope.resourceId,
    role: message.role,
    createdAt,
    content: {
      ...content,
      parts,
      metadata: { workflowSection: 'response', sourceMessageId: message.id },
    },
  }
}

/** Caller supplies server-owned invocation scope after public completion and financial acceptance. */
export async function writeFunctionalPayload(
  scope: FunctionalPayloadScope,
  payload: FunctionalPayload
): Promise<NativePayloadRef> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({
        endedAt: workflowExecutionLogs.endedAt,
        executionData: workflowExecutionLogs.executionData,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.id, scope.logId),
          eq(workflowExecutionLogs.workspaceId, scope.workspaceId),
          eq(workflowExecutionLogs.executionId, scope.executionId)
        )
      )
      .limit(1)
      .for('update')
    if (!owner || owner.endedAt || (owner.executionData as any)?.workflowArchive)
      throw new Error('Workflow payload writer is closed or its owning execution is unavailable')
    return writeOwnedFunctionalPayload(scope, payload, tx)
  })
}

async function writeOwnedFunctionalPayload(
  scope: FunctionalPayloadScope,
  payload: FunctionalPayload,
  tx: MemoryTransaction
): Promise<NativePayloadRef> {
  await assertOwner(scope, tx)
  if (payload.blocks !== undefined)
    assertOccurrenceIds(payload.blocks, 'Malformed functional block occurrence')
  const owned = identity(scope)
  rejectReservedWorkflowParts(payload.messages ?? [])
  if (
    (payload.messages ?? []).some(
      (message) =>
        message.role === 'system' ||
        message.role === 'signal' ||
        message.content.parts.some((part) => part.type === FUNCTIONAL_PART)
    )
  )
    throw new Error('Unexpected reserved native response payload')
  const memory = await getNativeMemory()
  const store = await getNativeMemoryStore()
  const existing = await memory.getThreadById({
    threadId: owned.threadId,
    resourceId: owned.resourceId,
  })
  if (
    existing &&
    (existing.id !== owned.threadId ||
      existing.resourceId !== owned.resourceId ||
      Object.entries(owned).some(([key, value]) => existing.metadata?.[key] !== value))
  )
    throw new Error('Workflow payload thread ownership mismatch')
  const thread =
    existing ??
    (await memory.createThread({
      threadId: owned.threadId,
      resourceId: owned.resourceId,
      metadata: owned,
      title: scope.blockId,
    }))
  const createdAt = thread.createdAt
  const input = (payload.selectedMessages ?? []).map((message, index) => {
    const encoded = encodeWorkflowMessage(
      message,
      owned,
      new Date(createdAt.getTime() + index),
      createWorkflowMessageId()
    )
    encoded.content.metadata = { ...encoded.content.metadata, workflowSection: 'input' }
    return encoded
  })
  const responses = (payload.messages ?? []).map((message, index) =>
    functionalMessage(message, owned, new Date(createdAt.getTime() + input.length + index))
  )
  // Capture live functional membership before branded diagnostic cost/token fields are removed.
  const toolResultIndexes = Array.isArray(payload.tools)
    ? payload.tools.flatMap((run, index) =>
        run && (run.success || run.result?.cost || run.result?.tokens) ? [index] : []
      )
    : undefined
  const {
    selectedMessages: _selected,
    messages: _messages,
    ...sections
  } = {
    ...payload,
    output: checkpointFunctionalOutput(payload.output),
    blocks: checkpointFunctionalOutput(payload.blocks),
    tools: checkpointFunctionalOutput(payload.tools),
    toolResultIndexes,
  }
  const terminal: MastraDBMessage = {
    id: createWorkflowMessageId(),
    threadId: owned.threadId,
    resourceId: owned.resourceId,
    role: 'assistant',
    createdAt: new Date(createdAt.getTime() + input.length + responses.length),
    content: {
      format: 2,
      parts: [{ type: FUNCTIONAL_PART, data: { version: 1, ...sections } }],
      metadata: { workflowSection: 'functional' },
    },
  }
  const messages = [...input, ...responses, terminal]
  const ref: NativePayloadRef = {
    ...owned,
    messageIds: messages.map(({ id }) => id),
    digest: digest(messages.map(messageFingerprint)),
  }
  await lockMemoryMessageIds(
    tx,
    messages.map(({ id }) => id)
  )
  // Upstream IDs are globally keyed. Check every existing collision's exact owner before upsert.
  for (let start = 0; start < messages.length; start += 100) {
    const existingMessages = await store.listMessagesById({
      messageIds: messages.slice(start, start + 100).map(({ id }) => id),
    })
    for (const message of existingMessages.messages) {
      const intended = messages.find(({ id }) => id === message.id)
      if (
        !intended ||
        message.threadId !== owned.threadId ||
        message.resourceId !== owned.resourceId ||
        digest(messageFingerprint(message)) !== digest(messageFingerprint(intended))
      )
        throw new Error('Immutable workflow payload message scope or content mismatch')
    }
  }
  let saveFailure: { error: unknown } | undefined
  try {
    await store.saveMessages({ messages })
  } catch (error) {
    saveFailure = { error }
  }
  try {
    // Unknown acknowledgement can only be confirmed through these SAME candidate IDs.
    // Never retry the save or allocate a different candidate to repair an uncertain write.
    await readFunctionalPayload(ref, tx)
    await assertOwner(scope, tx)
  } catch (error) {
    throw saveFailure ? saveFailure.error : error
  }
  return ref
}

function messageFingerprint(message: MastraDBMessage) {
  return [
    message.id,
    message.role,
    message.threadId,
    message.resourceId,
    new Date(message.createdAt).toISOString(),
    message.content,
  ]
}

/** Internal only: the caller must freshly authorize the current log before and after IO. */
export async function readNativePayloadMessages(
  ref: NativePayloadRef,
  owner: MemoryTransaction = db
): Promise<MastraDBMessage[]> {
  const owned = identity(ref)
  if (
    ref.version !== 1 ||
    ref.purpose !== 'workflow-agent' ||
    ref.threadId !== owned.threadId ||
    ref.resourceId !== owned.resourceId ||
    !Array.isArray(ref.messageIds) ||
    !ref.messageIds.length ||
    ref.messageIds.some((id) => typeof id !== 'string' || !id) ||
    new Set(ref.messageIds).size !== ref.messageIds.length ||
    typeof ref.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(ref.digest)
  )
    throw new Error('Invalid canonical workflow payload reference')
  await assertOwner(ref, owner)
  const store = await getNativeMemoryStore()
  const thread = await store.getThreadById({ threadId: ref.threadId, resourceId: ref.resourceId })
  if (
    !thread ||
    thread.id !== owned.threadId ||
    thread.resourceId !== owned.resourceId ||
    Object.entries(owned).some(([key, value]) => thread.metadata?.[key] !== value)
  )
    throw new Error('Canonical workflow payload thread is unavailable or mismatched')
  const byId = new Map<string, MastraDBMessage>()
  for (let start = 0; start < ref.messageIds.length; start += 100) {
    const messageIds = ref.messageIds.slice(start, start + 100)
    const result = await store.listMessagesById({ messageIds })
    if (!Array.isArray(result.messages) || result.messages.length !== messageIds.length)
      throw new Error('Canonical workflow payload readback digest/count mismatch')
    for (const message of result.messages) {
      if (
        !messageIds.includes(message.id) ||
        byId.has(message.id) ||
        message.threadId !== ref.threadId ||
        message.resourceId !== ref.resourceId ||
        message.content?.format !== 2 ||
        !Array.isArray(message.content.parts) ||
        !Number.isFinite(new Date(message.createdAt).getTime())
      )
        throw new Error('Canonical workflow payload readback digest/count mismatch')
      byId.set(message.id, message)
    }
  }
  // Native exact-ID reads do not promise order and may share a thread with other candidates.
  const messages = ref.messageIds.map((id) => byId.get(id)!)
  if (digest(messages.map(messageFingerprint)) !== ref.digest)
    throw new Error('Canonical workflow payload readback digest/count mismatch')
  await assertOwner(ref, owner)
  return messages
}

export async function readFunctionalPayload(
  ref: NativePayloadRef,
  owner: MemoryTransaction = db
): Promise<FunctionalPayload> {
  const messages = await readNativePayloadMessages(ref, owner)
  const selectedMessages: WorkflowMessage[] = []
  const responses: MastraDBMessage[] = []
  let sections: Record<string, unknown> | undefined
  for (const [index, message] of messages.entries()) {
    switch (message.content.metadata?.workflowSection) {
      case 'input':
        if (responses.length || sections)
          throw new Error('Invalid canonical workflow section order')
        selectedMessages.push(decodeWorkflowMessage(message, ref))
        break
      case 'response':
        if (sections || (message.role !== 'user' && message.role !== 'assistant'))
          throw new Error('Invalid canonical workflow response section')
        rejectReservedWorkflowParts([message])
        responses.push(message)
        break
      case 'functional': {
        const part = message.content.parts[0]
        if (
          sections ||
          index !== messages.length - 1 ||
          message.role !== 'assistant' ||
          message.content.parts.length !== 1 ||
          part.type !== FUNCTIONAL_PART ||
          !part.data ||
          typeof part.data !== 'object' ||
          (part.data as any).version !== 1
        )
          throw new Error('Malformed canonical functional section')
        const { version: _version, ...data } = part.data as Record<string, unknown>
        sections = data
        break
      }
      default:
        throw new Error('Unknown canonical workflow message section')
    }
  }
  if (!sections) throw new Error('Canonical workflow functional section is missing')
  await assertOwner(ref, owner)
  return { ...sections, selectedMessages, messages: responses }
}
