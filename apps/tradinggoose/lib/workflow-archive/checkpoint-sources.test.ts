import { beforeEach, describe, expect, it, vi } from 'vitest'

const seam = vi.hoisted(() => ({ authorize: vi.fn(), native: vi.fn() }))
vi.mock('@tradinggoose/db', () => ({ db: { select: vi.fn() } }))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: seam.authorize }))
vi.mock('@/lib/mastra/runtime', () => ({
  getNativeMemory: seam.native,
  getNativeMemoryStore: seam.native,
  getNativeWorkflowsStore: seam.native,
}))

import { getWorkflowMessageSource, workflowMessageDigest } from '@/lib/mastra/messages'
import { workflowMemoryIdentity } from '@/lib/mastra/workflow-memory'
import { attachWorkflowMessageSource } from '@/lib/mastra/workflow-message-source'
import { createMinimalWorkflow, createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { finalizeExecutorCheckpoint, saveExecutionContext } from '@/executor/checkpoint'
import { revalidateCheckpointMemorySources } from './checkpoint-sources'

function cold() {
  const value = { role: 'system' as const, content: ' exact🔥\n ' }
  const identity = workflowMemoryIdentity('workspace', 'original-owner', 'deleted-key')
  const message = attachWorkflowMessageSource(value, {
    messageId: 'original-deleted-id',
    ...identity,
    readProof: {
      version: 1,
      workspaceId: 'workspace',
      workflowId: 'original-owner',
      key: 'deleted-key',
      digest: workflowMessageDigest([value]),
    },
  })
  return JSON.parse(
    JSON.stringify(
      finalizeExecutorCheckpoint({
        workflow: createMinimalWorkflow(),
        context: saveExecutionContext(createMockContext({ workspaceId: 'workspace' })),
        currentBlockStates: { memory: { memories: [message] } },
        iteration: 1,
        finalOutput: {},
      })
    )
  )
}
beforeEach(() => {
  seam.authorize.mockReset().mockResolvedValue({
    ok: true,
    userId: 'original-actor',
    workspaceId: 'workspace',
    workflowId: 'original-owner',
  })
  seam.native.mockReset().mockRejectedValue(new Error('No live native key lookup is permitted'))
})
describe('authenticated checkpoint-owned Memory provenance', () => {
  it('restamps exact original proof after normal Delete/recreation without any live native reader', async () => {
    const checkpoint = cold()
    await revalidateCheckpointMemorySources(checkpoint, 'workspace', 'original-actor')
    expect(seam.authorize).toHaveBeenCalledWith(
      { success: true, userId: 'original-actor' },
      'original-owner',
      'read',
      expect.anything()
    )
    expect(seam.native).not.toHaveBeenCalled()
    expect(
      getWorkflowMessageSource(checkpoint.currentBlockStates.memory.memories[0])?.messageId
    ).toBe('original-deleted-id')
    expect(checkpoint.currentBlockStates.memory.memories[0].content).toBe(' exact🔥\n ')
  })
  it.each([
    'body',
    'digest',
    'old-version',
    'missing-proof',
    'foreign-workspace',
    'foreign-identity',
    'duplicate-path',
  ])('refuses %s before restamping or accessing native storage', async (kind) => {
    const checkpoint = cold()
    const entry = checkpoint.workflowMemorySources.entries[0]
    if (kind === 'body') checkpoint.currentBlockStates.memory.memories[0].content = 'changed'
    if (kind === 'digest') entry.digest = '0'.repeat(64)
    if (kind === 'old-version') checkpoint.workflowMemorySources.version = 1
    if (kind === 'missing-proof') entry.source.readProof = undefined
    if (kind === 'foreign-workspace') entry.source.readProof.workspaceId = 'foreign'
    if (kind === 'foreign-identity') entry.source.threadId = 'workflow-memory:foreign'
    if (kind === 'duplicate-path') checkpoint.workflowMemorySources.entries.push(entry)
    await expect(
      revalidateCheckpointMemorySources(checkpoint, 'workspace', 'original-actor')
    ).rejects.toThrow()
    expect(
      getWorkflowMessageSource(checkpoint.currentBlockStates.memory.memories[0])
    ).toBeUndefined()
    expect(seam.native).not.toHaveBeenCalled()
  })
  it('denies revoked/moved original owner and actual actor mismatch, preserving the checkpoint', async () => {
    for (const access of [
      { ok: false },
      { ok: true, workspaceId: 'moved', userId: 'original-actor' },
      { ok: true, workspaceId: 'workspace', userId: 'other' },
    ]) {
      const checkpoint = cold()
      const before = JSON.stringify(checkpoint)
      seam.authorize.mockResolvedValueOnce(access)
      await expect(
        revalidateCheckpointMemorySources(checkpoint, 'workspace', 'original-actor')
      ).rejects.toThrow(/owner|revoked/)
      expect(JSON.stringify(checkpoint)).toBe(before)
      expect(seam.native).not.toHaveBeenCalled()
    }
  })
})
