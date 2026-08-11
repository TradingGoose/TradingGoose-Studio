import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebhookAttachmentProcessor } from '@/lib/webhooks/attachment-processor'

const { uploadExecutionFileMock } = vi.hoisted(() => ({
  uploadExecutionFileMock: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: uploadExecutionFileMock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn() }),
}))

describe('WebhookAttachmentProcessor', () => {
  beforeEach(() => uploadExecutionFileMock.mockReset())

  it('does not start another upload after the attempt expires', async () => {
    let finishFirstUpload!: (value: unknown) => void
    uploadExecutionFileMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirstUpload = resolve
      })
    )
    const controller = new AbortController()
    const processing = WebhookAttachmentProcessor.processAttachments(
      [
        { name: 'first.txt', data: Buffer.from('first'), contentType: 'text/plain', size: 5 },
        { name: 'second.txt', data: Buffer.from('second'), contentType: 'text/plain', size: 6 },
      ],
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        requestId: 'request-1',
      },
      controller.signal
    )

    await vi.waitFor(() => expect(uploadExecutionFileMock).toHaveBeenCalledOnce())
    controller.abort()
    finishFirstUpload({ key: 'first.txt' })

    await expect(processing).rejects.toBeDefined()
    expect(uploadExecutionFileMock).toHaveBeenCalledOnce()
  })
})
