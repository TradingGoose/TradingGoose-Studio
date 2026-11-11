import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { StorageThreadType } from '@mastra/core/memory'
import type { MemoryStorage } from '@mastra/core/storage'
import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { AuthResult } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { WorkflowMemoryError } from './errors'
import {
  decodeWorkflowMessage,
  encodeWorkflowMessage,
  type WorkflowMessage,
  workflowMemoryIdentity,
} from './messages'
import { getAgentMemory, getNativeMemoryStore } from './runtime'

export type WorkflowMemoryRecord = {
  id: string
  workflowId: string
  key: string
  type: 'agent'
  data: WorkflowMessage[]
  createdAt: Date
  updatedAt: Date
}

type MemoryContext = { workspaceId: string; workflowId: string; store: MemoryStorage }

async function scoped<T>(
  auth: AuthResult,
  workflowId: string,
  access: 'read' | 'write',
  signal: AbortSignal | undefined,
  run: (context: MemoryContext) => Promise<T>
): Promise<T> {
  if (!auth.success || !auth.userId) throw new WorkflowMemoryError('Unauthorized', 401)
  signal?.throwIfAborted()
  return db.transaction(async (tx) => {
    // Match the workflow's normal database lifetime while the native operation runs.
    const [owner] = await tx
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .for(access === 'write' ? 'update' : 'key share')
      .limit(1)
    if (!owner) throw new WorkflowMemoryError('Workflow not found', 404)
    const scope = await authorizeWorkflowScope(auth, workflowId, access, tx)
    if (!scope.ok) throw new WorkflowMemoryError(scope.error, scope.status)
    signal?.throwIfAborted()
    const value = await run({ ...scope, store: await getNativeMemoryStore() })
    signal?.throwIfAborted()
    return value
  })
}

function identityFor(thread: StorageThreadType, workspaceId: string, workflowId: string) {
  const key = thread.metadata?.key
  if (typeof key !== 'string' || !key) throw new WorkflowMemoryError('Invalid Memory key', 403)
  const identity = workflowMemoryIdentity(workspaceId, workflowId, key)
  if (
    thread.id !== identity.threadId ||
    thread.resourceId !== identity.resourceId ||
    Object.entries(identity.metadata).some(([field, value]) => thread.metadata?.[field] !== value)
  )
    throw new WorkflowMemoryError('Memory is outside the authorized workflow', 403)
  return identity
}

function record(
  thread: StorageThreadType,
  workspaceId: string,
  workflowId: string,
  messages: MastraDBMessage[]
): WorkflowMemoryRecord {
  const identity = identityFor(thread, workspaceId, workflowId)
  return {
    id: thread.id,
    workflowId,
    key: identity.metadata.key,
    type: 'agent',
    data: messages.map((message) => decodeWorkflowMessage(message, identity)),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }
}

async function read(context: MemoryContext, key: string) {
  const { workspaceId, workflowId, store } = context
  const identity = workflowMemoryIdentity(workspaceId, workflowId, key)
  const thread = await store.getThreadById({ threadId: identity.threadId })
  if (!thread) throw new WorkflowMemoryError('Memory not found', 404)
  identityFor(thread, workspaceId, workflowId)
  const { messages } = await store.listMessages({
    threadId: identity.threadId,
    resourceId: identity.resourceId,
    perPage: false,
    orderBy: { field: 'createdAt', direction: 'ASC' },
  })
  if (!messages.length) throw new WorkflowMemoryError('Memory not found', 404)
  return record(thread, workspaceId, workflowId, messages)
}

export function getWorkflowMemory(
  auth: AuthResult,
  workflowId: string,
  key: string,
  signal?: AbortSignal
) {
  return scoped(auth, workflowId, 'read', signal, (context) => read(context, key))
}

export function getAllWorkflowMemory(auth: AuthResult, workflowId: string, signal?: AbortSignal) {
  return scoped(auth, workflowId, 'read', signal, async ({ workspaceId, store }) => {
    const { resourceId } = workflowMemoryIdentity(workspaceId, workflowId, '')
    const { threads } = await store.listThreads({
      filter: { resourceId, metadata: { purpose: 'workflow-memory', workspaceId, workflowId } },
      perPage: 50,
      orderBy: { field: 'createdAt', direction: 'ASC' },
    })
    if (!threads.length) return []
    for (const thread of threads) identityFor(thread, workspaceId, workflowId)
    const { messages } = await store.listMessages({
      threadId: threads.map(({ id }) => id),
      resourceId,
      perPage: false,
      orderBy: { field: 'createdAt', direction: 'ASC' },
    })
    const grouped = new Map<string, MastraDBMessage[]>(threads.map(({ id }) => [id, []]))
    for (const message of messages) {
      const entries = message.threadId ? grouped.get(message.threadId) : undefined
      if (!entries)
        throw new WorkflowMemoryError('Memory message is outside the selected threads', 403)
      entries.push(message)
    }
    return threads
      .map((thread) => record(thread, workspaceId, workflowId, grouped.get(thread.id)!))
      .filter(({ data }) => data.length)
  })
}

export function appendWorkflowMemory(
  auth: AuthResult,
  workflowId: string,
  key: string,
  message: WorkflowMessage,
  signal?: AbortSignal
) {
  return scoped(auth, workflowId, 'write', signal, async (context) => {
    const { workspaceId, store } = context
    const identity = workflowMemoryIdentity(workspaceId, workflowId, key)
    const existing = await store.getThreadById({ threadId: identity.threadId })
    if (existing) identityFor(existing, workspaceId, workflowId)
    else {
      await (await getAgentMemory()).createThread({
        threadId: identity.threadId,
        resourceId: identity.resourceId,
        title: key,
        metadata: identity.metadata,
      })
    }
    signal?.throwIfAborted()
    await store.saveMessages({ messages: [encodeWorkflowMessage(message, identity, new Date())] })
    return { record: await read(context, key), created: !existing }
  })
}

export function deleteWorkflowMemory(
  auth: AuthResult,
  workflowId: string,
  key: string,
  signal?: AbortSignal
) {
  return scoped(auth, workflowId, 'write', signal, async ({ workspaceId, store }) => {
    const identity = workflowMemoryIdentity(workspaceId, workflowId, key)
    const thread = await store.getThreadById({ threadId: identity.threadId })
    if (!thread) throw new WorkflowMemoryError('Memory not found', 404)
    identityFor(thread, workspaceId, workflowId)
    await store.deleteThread({ threadId: thread.id })
  })
}

/** Called after Studio deletes the owning workflow or workspace. */
export async function deleteWorkflowMemories(workspaceId: string, workflowId?: string) {
  const store = await getNativeMemoryStore()
  const { threads } = await store.listThreads({
    filter: {
      metadata: { purpose: 'workflow-memory', workspaceId, ...(workflowId ? { workflowId } : {}) },
    },
    perPage: false,
  })
  for (const thread of threads) {
    const ownerId = thread.metadata?.workflowId
    if (typeof ownerId !== 'string') throw new WorkflowMemoryError('Invalid Memory owner', 403)
    identityFor(thread, workspaceId, ownerId)
    await store.deleteThread({ threadId: thread.id })
  }
}
