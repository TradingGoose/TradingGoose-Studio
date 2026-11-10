/** Correlation IDs never authorize a native read/write or model instruction. */
export type WorkflowMessageReadProof = {
  version: 1
  workspaceId: string
  workflowId: string
  key: string
  digest: string
}
export type WorkflowMessageSource = {
  messageId: string
  threadId: string
  resourceId: string
  /** Issued only on an authorized COMPLETE facade read, never by correlation-only decoding. */
  readProof?: Readonly<WorkflowMessageReadProof>
}
export type WorkflowMessageSourceTransport = WorkflowMessageSource & {
  digest: string
  ordinal: number
}
const WORKFLOW_SOURCE = Symbol('trusted-workflow-message-source')

export function getWorkflowMessageSource(message: unknown): WorkflowMessageSource | undefined {
  return message && typeof message === 'object' && Object.hasOwn(message, WORKFLOW_SOURCE)
    ? (message as Record<symbol, WorkflowMessageSource>)[WORKFLOW_SOURCE]
    : undefined
}

export function attachWorkflowMessageSource<T extends object>(
  message: T,
  source: WorkflowMessageSource
): T {
  if (
    !source.messageId ||
    !source.threadId.startsWith('workflow-memory:') ||
    !source.resourceId.startsWith('workflow-memory:')
  )
    throw new Error('Invalid workflow Memory source correlation')
  const proof = source.readProof
  if (
    proof &&
    (Object.keys(proof).sort().join(',') !== 'digest,key,version,workflowId,workspaceId' ||
      proof.version !== 1 ||
      ![proof.workspaceId, proof.workflowId, proof.key].every(
        (value) => typeof value === 'string' && value.length > 0
      ) ||
      typeof proof.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(proof.digest))
  )
    throw new Error('Invalid original Memory read proof')
  const existing = getWorkflowMessageSource(message)
  if (existing) {
    if (
      existing.messageId !== source.messageId ||
      existing.threadId !== source.threadId ||
      existing.resourceId !== source.resourceId ||
      JSON.stringify(existing.readProof) !== JSON.stringify(proof)
    )
      throw new Error('Conflicting trusted Memory source correlation')
    return message
  }
  Object.defineProperty(message, WORKFLOW_SOURCE, {
    value: Object.freeze({
      messageId: source.messageId,
      threadId: source.threadId,
      resourceId: source.resourceId,
      ...(proof ? { readProof: Object.freeze({ ...proof }) } : {}),
    }),
    enumerable: false,
  })
  return message
}

export function copyWorkflowMessageSource<T extends object>(from: unknown, to: T): T {
  const source = getWorkflowMessageSource(from)
  return source ? attachWorkflowMessageSource(to, source) : to
}

/** Called only by fixed first-party Memory transports, never an arbitrary model/tool result decoder. */
export async function readWorkflowMemoryTransport(
  record: unknown
): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>> {
  if (
    !record ||
    typeof record !== 'object' ||
    !('data' in record) ||
    !('sourceRefs' in record) ||
    !Array.isArray(record.data) ||
    !Array.isArray(record.sourceRefs) ||
    record.data.length !== record.sourceRefs.length
  )
    throw new Error('Memory source correlation is missing or incomplete')
  const seen = new Set<string>()
  const sources = record.sourceRefs
  return Promise.all(
    record.data.map(async (message, index) => {
      const source = sources[index] as WorkflowMessageSourceTransport
      if (
        !message ||
        typeof message !== 'object' ||
        !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' ||
        !source ||
        Object.keys(source).sort().join(',') !==
          'digest,messageId,ordinal,readProof,resourceId,threadId' ||
        typeof source.messageId !== 'string' ||
        typeof source.threadId !== 'string' ||
        typeof source.resourceId !== 'string' ||
        typeof source.digest !== 'string' ||
        !source.readProof ||
        source.readProof.version !== 1 ||
        !('workflowId' in record) ||
        record.workflowId !== source.readProof.workflowId ||
        !('key' in record) ||
        record.key !== source.readProof.key ||
        !('id' in record) ||
        record.id !== source.threadId ||
        source.digest !== source.readProof.digest ||
        source.ordinal !== index ||
        seen.has(source.messageId)
      )
        throw new Error('Invalid Memory message/source ordering')
      seen.add(source.messageId)
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify([[message.role, message.content]]))
      )
      if (
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
          ''
        ) !== source.digest
      )
        throw new Error('Memory message/source content mismatch')
      return attachWorkflowMessageSource(
        { role: message.role, content: message.content },
        {
          messageId: source.messageId,
          threadId: source.threadId,
          resourceId: source.resourceId,
          readProof: source.readProof,
        }
      )
    })
  )
}
