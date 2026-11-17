import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ failed: vi.fn(), process: vi.fn() }))
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
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('KB_CONFIG_MAX_DURATION', undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
it('passes the queued actor to processing and the document ID to failure reporting', async () => {
  const signal = new AbortController().signal
  await executeDocumentProcessingJob(payload, signal)
  expect(m.process).toHaveBeenCalledExactlyOnceWith(
    'kb',
    'doc',
    payload.docData,
    payload.processingOptions,
    { actorUserId: 'actor', workspaceId: 'workspace', signal: expect.any(AbortSignal) }
  )
  await markDocumentProcessingJobFailed(payload, 'failed')
  expect(m.failed).toHaveBeenCalledExactlyOnceWith('doc', 'failed')
})
it.each([
  { duration: undefined, seconds: 600 },
  { duration: '5', seconds: 5 },
])('bounds a stalled processor to $seconds seconds', async ({ duration, seconds }) => {
  vi.stubEnv('KB_CONFIG_MAX_DURATION', duration)
  let release!: () => void
  m.process.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  let settled = false
  const execution = executeDocumentProcessingJob(payload).finally(() => {
    settled = true
  })
  void execution.catch(() => undefined)
  try {
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    const signal = m.process.mock.calls[0][4].signal as AbortSignal
    expect(signal.aborted).toBe(true)
    await expect(execution).rejects.toBe(signal.reason)
    expect(m.failed).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    release()
    await execution.catch(() => undefined)
  }
})
it('settles an externally cancelled job even when processing ignores its signal', async () => {
  let release!: () => void
  m.process.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const controller = new AbortController()
  let settled = false
  const execution = executeDocumentProcessingJob(payload, controller.signal).finally(() => {
    settled = true
  })
  void execution.catch(() => undefined)
  const reason = new Error('Native task cancelled')
  try {
    controller.abort(reason)
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    expect(m.process.mock.calls[0][4].signal.aborted).toBe(true)
    await expect(execution).rejects.toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    release()
    await execution.catch(() => undefined)
  }
})
it.each([false, true])('clears the deadline when processing fails=%s', async (failed) => {
  const error = new Error('Parser failed')
  if (failed) m.process.mockRejectedValueOnce(error)
  else m.process.mockResolvedValueOnce(undefined)
  const execution = executeDocumentProcessingJob(payload)
  if (failed) await expect(execution).rejects.toBe(error)
  else await execution
  expect(vi.getTimerCount()).toBe(0)
})
it.each([null, {}, { documentId: 'foreign' }, { ...payload, userId: undefined }])(
  'never treats partial failure payload %j as row mutation authority',
  async (input) => {
    await markDocumentProcessingJobFailed(input, 'failed')
    expect(m.failed).not.toHaveBeenCalled()
  }
)
it('propagates failure-update errors', async () => {
  m.failed.mockRejectedValue(Object.assign(new Error('revoked'), { status: 403 }))
  await expect(markDocumentProcessingJobFailed(payload, 'failed')).rejects.toMatchObject({
    status: 403,
  })
  expect(m.failed).toHaveBeenCalledOnce()
})
