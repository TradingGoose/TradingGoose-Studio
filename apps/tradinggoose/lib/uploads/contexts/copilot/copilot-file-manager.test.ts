/** @vitest-environment node */
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeCopilotAttachments,
  processCopilotAttachments,
  uploadCopilotFile,
} from './copilot-file-manager'

const state = vi.hoisted(() => ({
  env: { INTERNAL_API_SECRET: 'disposable-source-proof-key-only-12345' },
  config: { bucket: 'disposable-copilot-bucket', region: 'us-east-1' },
  upload: vi.fn(),
  download: vi.fn(),
  access: vi.fn(),
}))
vi.mock('@/lib/env', () => ({ env: state.env }))
vi.mock('@/lib/uploads/core/config-resolver', () => ({ getStorageConfig: () => state.config }))
vi.mock('@/lib/uploads/core/setup', () => ({ getStorageProvider: () => 's3' }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: state.upload,
  downloadFile: state.download,
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: state.access }))

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=',
  'base64'
)
const scope = { actorUserId: 'owner', workspaceId: null }
async function owned(actorUserId = 'owner') {
  const file = await uploadCopilotFile({
    actorUserId,
    buffer: png,
    filename: 'image.png',
    mediaType: 'image/png',
  })
  state.download.mockClear()
  return {
    key: file.key,
    sourceProof: file.sourceProof,
    filename: file.name,
    media_type: file.type,
    size: file.size,
  }
}
function signedChange(token: string, patch: Record<string, unknown>) {
  const [header, body] = token.split('.')
  const payload = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), ...patch })
  ).toString('base64url')
  const data = `${header}.${payload}`
  return `${data}.${createHmac('sha256', state.env.INTERNAL_API_SECRET).update(data).digest('base64url')}`
}

beforeEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  state.env.INTERNAL_API_SECRET = 'disposable-source-proof-key-only-12345'
  state.config.bucket = 'disposable-copilot-bucket'
  state.access.mockResolvedValue({ hasAccess: true })
  state.upload.mockImplementation(async (input) => ({
    key: input.customKey,
    name: input.fileName,
    type: input.contentType,
    size: input.file.length,
    path: `/api/files/serve/s3/${encodeURIComponent(input.customKey)}`,
  }))
  state.download.mockResolvedValue(png)
})
afterEach(() => vi.useRealTimers())

describe('Copilot completed source authorization', () => {
  it('signs only a genuine immutable server allocation and exact stored-byte readback', async () => {
    const file = await owned()
    expect(state.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'copilot',
        preventOverwrite: true,
        preserveKey: true,
        file: png,
        customKey: expect.stringMatching(/^copilot\/[0-9a-f-]+-image\.png$/),
      })
    )
    expect(file.sourceProof).toBeTruthy()
    const sources = await authorizeCopilotAttachments([file], scope)
    expect(sources[0]).toMatchObject({
      actorUserId: 'owner',
      context: 'copilot',
      key: file.key,
      size: png.length,
    })
    expect(sources[0].exp - sources[0].iat).toBe(3600)
    expect(state.download).not.toHaveBeenCalled()
  })

  it.each([null, 'workspace-1'])(
    'delivers complete owned bytes under genuine workspace %s',
    async (workspaceId) => {
      const file = await owned()
      const signal = new AbortController().signal
      const result = await processCopilotAttachments(
        [file],
        { actorUserId: 'owner', workspaceId },
        'request',
        signal
      )
      expect(result).toEqual([
        {
          buffer: png,
          attachment: {
            key: file.key,
            filename: 'image.png',
            media_type: 'image/png',
            size: png.length,
          },
        },
      ])
      expect(state.download).toHaveBeenCalledOnce()
      if (workspaceId) expect(state.access).toHaveBeenCalledWith(workspaceId, 'owner')
      else expect(state.access).not.toHaveBeenCalled()
    }
  )

  it('refuses unauthenticated actor before any byte retrieval', async () => {
    const file = await owned()
    await expect(
      processCopilotAttachments([file], { actorUserId: '', workspaceId: null }, 'request')
    ).rejects.toMatchObject({ status: 401 })
    expect(state.download).not.toHaveBeenCalled()
  })

  it('refuses cross-user and whole mixed batches before the first download', async () => {
    const mine = await owned()
    const foreign = await owned('another-user')
    await expect(processCopilotAttachments([foreign], scope, 'request')).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      processCopilotAttachments([mine, foreign], scope, 'request')
    ).rejects.toMatchObject({ status: 403 })
    expect(state.download).not.toHaveBeenCalled()
  })

  it('refuses revoked workspace scope even for a valid owner proof', async () => {
    const file = await owned()
    state.access.mockResolvedValueOnce({ hasAccess: false })
    await expect(
      processCopilotAttachments([file], { actorUserId: 'owner', workspaceId: 'revoked' }, 'request')
    ).rejects.toMatchObject({ status: 403 })
    expect(state.download).not.toHaveBeenCalled()
  })

  it.each(['key', 'filename', 'media_type', 'size'] as const)(
    'refuses tampered display/reference %s without downloads',
    async (field) => {
      const file = await owned()
      const changed = { ...file, [field]: field === 'size' ? png.length + 1 : 'tampered' }
      await expect(processCopilotAttachments([changed], scope, 'request')).rejects.toMatchObject({
        status: 403,
      })
      expect(state.download).not.toHaveBeenCalled()
    }
  )

  it('refuses signed wrong context, disguised key and unsigned flat references', async () => {
    const file = await owned()
    for (const changed of [
      { ...file, sourceProof: signedChange(file.sourceProof, { context: 'general' }) },
      { ...file, key: encodeURIComponent(file.key) },
      { key: '12345-unsigned.png', sourceProof: 'missing' },
    ])
      await expect(processCopilotAttachments([changed], scope, 'request')).rejects.toMatchObject({
        status: 403,
      })
    expect(state.download).not.toHaveBeenCalled()
  })

  it('refuses expired authorization without renewing it from its key', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T00:00:00Z'))
    const file = await owned()
    vi.advanceTimersByTime(3_600_001)
    await expect(processCopilotAttachments([file], scope, 'request')).rejects.toThrow(
      'invalid or expired'
    )
    expect(state.download).not.toHaveBeenCalled()
    expect(state.upload).toHaveBeenCalledOnce()
  })

  it.each(['key', 'storage'])(
    'refuses %s rotation without an old-key or storage fallback',
    async (kind) => {
      const file = await owned()
      if (kind === 'key') state.env.INTERNAL_API_SECRET = 'rotated-disposable-key-only'
      else state.config.bucket = 'different-backing-store'
      await expect(processCopilotAttachments([file], scope, 'request')).rejects.toThrow(
        'invalid or expired'
      )
      expect(state.download).not.toHaveBeenCalled()
    }
  )

  it.each(['empty', 'changed', 'failed'])(
    'refuses %s storage media instead of returning a successful prefix',
    async (kind) => {
      const first = await owned()
      const second = await owned()
      state.download.mockResolvedValueOnce(png)
      if (kind === 'failed')
        state.download.mockRejectedValueOnce(new Error('private provider diagnostic'))
      else
        state.download.mockResolvedValueOnce(
          kind === 'empty' ? Buffer.alloc(0) : Buffer.from('changed')
        )
      await expect(
        processCopilotAttachments([first, second], scope, 'request')
      ).rejects.toMatchObject({ status: 422 })
      expect(state.download).toHaveBeenCalledTimes(2)
    }
  )

  it('refuses unsupported or disguised media before any upload or source proof', async () => {
    for (const mediaType of ['application/pdf', 'image/png']) {
      await expect(
        uploadCopilotFile({
          actorUserId: 'owner',
          buffer: Buffer.from('not an image'),
          filename: 'image.png',
          mediaType,
        })
      ).rejects.toMatchObject({ status: 415 })
    }
    expect(state.upload).not.toHaveBeenCalled()
    expect(state.download).not.toHaveBeenCalled()
  })

  it.each(['header-only', 'corrupt-pixels'])(
    'refuses %s PNG despite valid magic bytes before any allocation or readback',
    async (kind) => {
      const buffer = Buffer.from(png)
      if (kind === 'corrupt-pixels') buffer[buffer.indexOf(Buffer.from('IDAT')) + 5] ^= 255
      await expect(
        uploadCopilotFile({
          actorUserId: 'owner',
          buffer: kind === 'header-only' ? buffer.subarray(0, 8) : buffer,
          filename: 'broken.png',
          mediaType: 'image/png',
        })
      ).rejects.toMatchObject({ status: 415 })
      expect(state.upload).not.toHaveBeenCalled()
      expect(state.download).not.toHaveBeenCalled()
    }
  )

  it('does not sign a failed upload readback', async () => {
    state.download.mockResolvedValueOnce(Buffer.from('wrong object'))
    await expect(
      uploadCopilotFile({
        actorUserId: 'owner',
        buffer: png,
        filename: 'image.png',
        mediaType: 'image/png',
      })
    ).rejects.toMatchObject({ status: 503 })
  })

  it('decodes the verified upload readback and never exposes raw decoder diagnostics', async () => {
    const buffer = Buffer.from(png)
    state.upload.mockImplementationOnce(async (input) => {
      buffer[buffer.indexOf(Buffer.from('IDAT')) + 5] ^= 255
      return {
        key: input.customKey,
        name: input.fileName,
        type: input.contentType,
        size: input.file.length,
        path: `/api/files/serve/s3/${encodeURIComponent(input.customKey)}`,
      }
    })
    state.download.mockResolvedValueOnce(buffer)

    await expect(
      uploadCopilotFile({
        actorUserId: 'owner',
        buffer,
        filename: 'image.png',
        mediaType: 'image/png',
      })
    ).rejects.toMatchObject({
      status: 415,
      message: 'Attachment image could not be decoded; upload a complete supported image again',
    })
    expect(state.upload).toHaveBeenCalledOnce()
    expect(state.download).toHaveBeenCalledOnce()
  })

  it('preserves cancellation during the awaited decode before any allocation', async () => {
    const controller = new AbortController()
    const reason = new Error('Caller cancelled image validation')
    const completion = uploadCopilotFile({
      actorUserId: 'owner',
      buffer: png,
      filename: 'image.png',
      mediaType: 'image/png',
      signal: controller.signal,
    })
    controller.abort(reason)

    await expect(completion).rejects.toBe(reason)
    expect(state.upload).not.toHaveBeenCalled()
    expect(state.download).not.toHaveBeenCalled()
  })

  it('preserves cancellation after one authorized download and never starts the next', async () => {
    const first = await owned()
    const second = await owned()
    const controller = new AbortController()
    const reason = new Error('Caller cancelled')
    state.download.mockImplementationOnce(async () => {
      controller.abort(reason)
      return png
    })
    await expect(
      processCopilotAttachments([first, second], scope, 'request', controller.signal)
    ).rejects.toBe(reason)
    expect(state.download).toHaveBeenCalledOnce()
  })
})
