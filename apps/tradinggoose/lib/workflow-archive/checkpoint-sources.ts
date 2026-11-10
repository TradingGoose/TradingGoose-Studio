import { db } from '@tradinggoose/db'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { workflowMemoryIdentity, workflowMessageDigest } from '@/lib/mastra/messages'
import {
  attachWorkflowMessageSource,
  type WorkflowMessageSource,
} from '@/lib/mastra/workflow-message-source'
import type { ExecutorCheckpoint } from '@/executor/checkpoint'

/** Only authenticated server-decrypted checkpoints may call this; never accept request JSON. */
export async function revalidateCheckpointMemorySources(
  checkpoint: ExecutorCheckpoint,
  workspaceId: string,
  actorUserId: string,
  connection: Pick<typeof db, 'select'> = db
): Promise<void> {
  const manifest = checkpoint.workflowMemorySources
  if (!manifest) return // Source-free checkpoints never acquire guessed provenance.
  if (manifest.version !== 2 || !Array.isArray(manifest.entries))
    throw new Error(
      'Original read-time checkpoint Memory proof is unavailable; keep checkpoint pinned'
    )
  if (!workspaceId || !actorUserId) throw new Error('Checkpoint Memory actor/scope is unavailable')
  const owners = new Set<string>()
  const paths = new Set<string>()
  const validated: Array<{ value: object; source: WorkflowMessageSource }> = []
  for (const entry of manifest.entries) {
    const source = entry?.source
    const proof = source?.readProof
    if (
      !entry ||
      !Array.isArray(entry.path) ||
      !entry.path.length ||
      !['context', 'currentBlockStates', 'finalOutput'].includes(String(entry.path[0])) ||
      typeof entry.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.digest) ||
      !source ||
      Object.keys(source).sort().join(',') !== 'messageId,readProof,resourceId,threadId' ||
      typeof source.messageId !== 'string' ||
      !source.messageId ||
      typeof source.threadId !== 'string' ||
      typeof source.resourceId !== 'string' ||
      !proof ||
      Object.keys(proof).sort().join(',') !== 'digest,key,version,workflowId,workspaceId' ||
      proof.version !== 1 ||
      proof.workspaceId !== workspaceId ||
      typeof proof.workflowId !== 'string' ||
      !proof.workflowId ||
      typeof proof.key !== 'string' ||
      !proof.key ||
      typeof proof.digest !== 'string' ||
      proof.digest !== entry.digest
    )
      throw new Error('Malformed original checkpoint Memory read proof/scope/path')
    const identity = workflowMemoryIdentity(proof.workspaceId, proof.workflowId, proof.key)
    if (identity.threadId !== source.threadId || identity.resourceId !== source.resourceId)
      throw new Error('Checkpoint Memory original owner identity differs')
    const pathKey = JSON.stringify(entry.path)
    if (paths.has(pathKey)) throw new Error('Duplicate checkpoint source path')
    paths.add(pathKey)
    let value: any = checkpoint
    for (const segment of entry.path) {
      if (
        (typeof segment !== 'string' &&
          (typeof segment !== 'number' || !Number.isSafeInteger(segment) || segment < 0)) ||
        !value ||
        typeof value !== 'object' ||
        !Object.hasOwn(value, segment) ||
        (Array.isArray(value) && typeof segment !== 'number')
      )
        throw new Error('Checkpoint source path no longer exists')
      value = value[segment]
    }
    if (
      !value ||
      !['system', 'user', 'assistant'].includes(value.role) ||
      typeof value.content !== 'string' ||
      workflowMessageDigest([value]) !== proof.digest
    )
      throw new Error('Checkpoint Memory original body/source hash differs')
    if (!owners.has(proof.workflowId)) {
      const access = await authorizeWorkflowScope(
        { success: true, userId: actorUserId },
        proof.workflowId,
        'read',
        connection
      )
      if (!access.ok || access.workspaceId !== workspaceId || access.userId !== actorUserId)
        throw new Error('Checkpoint Memory original source owner access is unavailable or revoked')
      owners.add(proof.workflowId)
    }
    validated.push({ value, source })
  }
  for (const { value, source } of validated) attachWorkflowMessageSource(value, source)
}
