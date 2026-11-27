import { afterEach, expect, it, vi } from 'vitest'
import { executeDocumentProcessingJob } from './knowledge-processing'

const processDocumentAsync = vi.hoisted(() => vi.fn())
vi.mock('@/lib/knowledge/documents/service', () => ({ processDocumentAsync }))
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

const job = { id: 'document_processing:doc:original', payload }
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
it('runs with the admitted actor, signal and original local nonce', async () => {
  const signal = new AbortController().signal
  await executeDocumentProcessingJob(job, signal, 'nonce')
  expect(processDocumentAsync).toHaveBeenCalledWith(
    payload,
    { id: job.id, localDocumentNonce: 'nonce' },
    signal
  )
})
it('waits for healthy work beyond the former ten and thirty minute cutoffs', async () => {
  vi.useFakeTimers()
  let resolve!: () => void
  processDocumentAsync.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done
    })
  )
  let finished = false
  const execution = executeDocumentProcessingJob(job).then(() => {
    finished = true
  })
  await vi.advanceTimersByTimeAsync(3600_000)
  expect(finished).toBe(false)
  resolve()
  await execution
  expect(finished).toBe(true)
})
it.each([null, {}, { documentId: 'foreign' }, { ...payload, userId: undefined }])(
  'rejects incomplete payload %j',
  async (value) => {
    await expect(executeDocumentProcessingJob({ ...job, payload: value })).rejects.toThrow(
      'Invalid document'
    )
    expect(processDocumentAsync).not.toHaveBeenCalled()
  }
)
