import { beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ failed: vi.fn(), process: vi.fn() }))
vi.mock('@trigger.dev/sdk', () => ({ task: (definition: unknown) => definition }))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/knowledge/documents/service', () => ({
  markDocumentProcessingFailed: m.failed,
  processDocumentAsync: m.process,
}))

import {
  executeDocumentProcessingJob,
  markDocumentProcessingJobFailed,
} from './knowledge-processing'

const payload = {
  knowledgeBaseId: 'kb',
  documentId: 'doc',
  userId: 'actor',
  workspaceId: 'workspace',
  requestId: 'original',
  docData: {
    fileUrl: 'https://public.example/file.txt',
    filename: 'file.txt',
    fileSize: 4,
    mimeType: 'text/plain',
  },
  processingOptions: { chunkSize: 1000, chunkOverlap: 200, minCharactersPerChunk: 1 },
}
beforeEach(() => vi.resetAllMocks())
it('passes actual queued actor/source/scope for ordinary execution and freshly authorized failure reporting', async () => {
  await executeDocumentProcessingJob(payload)
  expect(m.process).toHaveBeenCalledExactlyOnceWith(
    'kb',
    'doc',
    payload.docData,
    payload.processingOptions,
    { actorUserId: 'actor', workspaceId: 'workspace' }
  )
  await markDocumentProcessingJobFailed(payload, 'failed')
  expect(m.failed).toHaveBeenCalledExactlyOnceWith(
    'kb',
    'doc',
    payload.docData,
    { actorUserId: 'actor', workspaceId: 'workspace' },
    'failed'
  )
})
it.each([null, {}, { documentId: 'foreign' }, { ...payload, userId: undefined }])(
  'never treats partial failure payload %j as row mutation authority',
  async (input) => {
    await markDocumentProcessingJobFailed(input, 'failed')
    expect(m.failed).not.toHaveBeenCalled()
  }
)
it('retains a fresh canonical authorization refusal rather than falling back to documentId-only updates', async () => {
  m.failed.mockRejectedValue(Object.assign(new Error('revoked'), { status: 403 }))
  await expect(markDocumentProcessingJobFailed(payload, 'failed')).rejects.toMatchObject({
    status: 403,
  })
  expect(m.failed).toHaveBeenCalledOnce()
})
