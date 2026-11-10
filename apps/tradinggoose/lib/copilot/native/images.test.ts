/** @vitest-environment node */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseNativeContract } from '@/lib/copilot/native/contract'
import { prepareNativeImageParts } from '@/lib/copilot/native/images'
import {
  type CopilotAttachmentScope,
  type CopilotFileAttachment,
  uploadCopilotFile,
} from '@/lib/uploads/contexts/copilot/copilot-file-manager'
import { signCopilotSource } from '@/lib/uploads/contexts/copilot/source-proof'
import { assertStorageReadAccess } from '@/lib/uploads/source-read-boundary'

const state = vi.hoisted(() => ({
  env: { INTERNAL_API_SECRET: 'disposable-r15-image-proof-secret-12345' },
  config: { bucket: 'disposable-r15-image-bucket', region: 'us-east-1' },
  files: new Map<string, Buffer>(),
  upload: vi.fn(),
  download: vi.fn(),
  access: vi.fn(),
  delegate: vi.fn(),
  fetcher: vi.fn(),
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
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'
)
// Owned two-frame fixture encoded with installed Sharp; both frames must remain byte-identical.
const gif = Buffer.from(
  'R0lGODlhAQABAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAQABAAACAkwBACH5BAUKAAAALAAAAAABAAEAgExpcQAA/wICTAEAOw==',
  'base64'
)
const scope: CopilotAttachmentScope = { actorUserId: 'owner', workspaceId: null }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
async function owned(buffer = png, mediaType = 'image/png', actorUserId = 'owner') {
  const file = await uploadCopilotFile({ actorUserId, buffer, filename: 'owned-image', mediaType })
  state.download.mockClear()
  return {
    key: file.key,
    sourceProof: file.sourceProof,
    filename: file.name,
    media_type: file.type,
    size: file.size,
  }
}
/** Synthetic delegate only: the actual authenticated service route is covered by its owner. */
async function delegate(
  attachments: CopilotFileAttachment[],
  conversation = scope,
  signal?: AbortSignal
) {
  const parts = await prepareNativeImageParts(
    attachments,
    conversation,
    'request-r15-images',
    signal
  )
  state.delegate(parts)
  return parts
}

beforeEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  state.files.clear()
  state.env.INTERNAL_API_SECRET = 'disposable-r15-image-proof-secret-12345'
  state.config.bucket = 'disposable-r15-image-bucket'
  state.access.mockResolvedValue({ hasAccess: true })
  state.upload.mockImplementation(async (input) => {
    if (!input.preventOverwrite || state.files.has(input.customKey))
      throw new Error('Synthetic no-overwrite allocation refused')
    state.files.set(input.customKey, Buffer.from(input.file))
    return {
      key: input.customKey,
      name: input.fileName,
      type: input.contentType,
      size: input.file.length,
      path: `/api/files/serve/s3/${encodeURIComponent(input.customKey)}`,
    }
  })
  state.download.mockImplementation(async ({ key, context }) => {
    assertStorageReadAccess(key, context)
    const bytes = state.files.get(key)
    if (!bytes) throw new Error('Synthetic object missing')
    return Buffer.from(bytes)
  })
  vi.stubGlobal('fetch', state.fetcher)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('authorized source to native inline image parts', () => {
  it('delivers original mixed image bytes and verified MIME in selection order without source locators', async () => {
    const first = await owned(svg, 'image/svg+xml')
    const second = await owned(gif, 'image/gif')
    const third = await owned(png)
    const before = [digest(svg), digest(gif), digest(png)]

    const parts = await delegate([first, second, third])

    expect(parts).toEqual([
      {
        type: 'image',
        image: `data:image/svg+xml;base64,${svg.toString('base64')}`,
        mediaType: 'image/svg+xml',
      },
      {
        type: 'image',
        image: `data:image/gif;base64,${gif.toString('base64')}`,
        mediaType: 'image/gif',
      },
      {
        type: 'image',
        image: `data:image/png;base64,${png.toString('base64')}`,
        mediaType: 'image/png',
      },
    ])
    for (const part of parts) expect(await parseNativeContract('ImagePart', part)).toEqual(part)
    expect(parts.map((part) => digest(Buffer.from(part.image.split(',')[1], 'base64')))).toEqual(
      before
    )
    expect([digest(svg), digest(gif), digest(png)]).toEqual(before)
    expect(state.download.mock.calls.map(([input]) => input.key)).toEqual([
      first.key,
      second.key,
      third.key,
    ])
    expect(state.delegate).toHaveBeenCalledExactlyOnceWith(parts)
    expect(state.fetcher).not.toHaveBeenCalled()
    expect(JSON.stringify(parts)).not.toContain(first.key)
    expect(JSON.stringify(parts)).not.toContain(first.sourceProof)
  })

  it('preserves an authorized personal empty image batch without inventing media content', async () => {
    expect(await prepareNativeImageParts([], scope, 'empty')).toEqual([])
    expect(state.download).not.toHaveBeenCalled()
    expect(state.delegate).not.toHaveBeenCalled()
  })

  it.each([
    'actor',
    'cross-actor',
    'mixed-owner',
    'revoked',
    'tampered',
    'unsigned',
    'locator-envelope',
  ])('refuses whole batch %s before any source download or synthetic delegation', async (kind) => {
    const mine = await owned()
    const foreign = await owned(png, 'image/png', 'another-owner')
    let attachments: CopilotFileAttachment[] = [mine]
    let conversation = scope
    if (kind === 'actor') conversation = { ...scope, actorUserId: '' }
    if (kind === 'cross-actor') attachments = [foreign]
    if (kind === 'mixed-owner') attachments = [mine, foreign]
    if (kind === 'revoked') {
      conversation = { ...scope, workspaceId: 'revoked-workspace' }
      state.access.mockResolvedValueOnce({ hasAccess: false })
    }
    if (kind === 'tampered') attachments = [{ ...mine, media_type: 'image/jpeg' }]
    if (kind === 'unsigned') attachments = [{ key: 'copilot/unowned.png', sourceProof: 'missing' }]
    if (kind === 'locator-envelope') {
      const withLocator = { ...mine, url: '/api/files/serve/copilot/private.png' }
      attachments = [withLocator]
    }

    await expect(delegate(attachments, conversation)).rejects.toMatchObject({
      status: kind === 'actor' ? 401 : 403,
    })
    expect(state.download).not.toHaveBeenCalled()
    expect(state.delegate).not.toHaveBeenCalled()
    expect(state.fetcher).not.toHaveBeenCalled()
  })

  it('rejects expired proof without downloading or renewing from source key', async () => {
    const file = await owned()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 3_600_001))
    await expect(delegate([file])).rejects.toMatchObject({ status: 403 })
    expect(state.download).not.toHaveBeenCalled()
    expect(state.upload).toHaveBeenCalledOnce()
    expect(state.delegate).not.toHaveBeenCalled()
  })

  it('rechecks signed expiration after actual pixel decoding before native delegation', async () => {
    const file = await owned()
    const claims = JSON.parse(Buffer.from(file.sourceProof.split('.')[1], 'base64url').toString())
    vi.useFakeTimers()
    vi.setSystemTime(new Date(claims.exp * 1000 - 1000))
    const originalStats = sharp.prototype.stats
    vi.spyOn(sharp.prototype, 'stats').mockImplementationOnce(function (this: sharp.Sharp) {
      return originalStats.call(this).then((stats: sharp.Stats) => {
        vi.setSystemTime(new Date(claims.exp * 1000 + 1))
        return stats
      })
    })

    await expect(delegate([file])).rejects.toMatchObject({ status: 422 })
    expect(state.download).toHaveBeenCalledOnce()
    expect(state.delegate).not.toHaveBeenCalled()
  })

  it('never returns or delegates a successful prefix when a later authorized source is missing', async () => {
    const first = await owned()
    const second = await owned(svg, 'image/svg+xml')
    state.files.delete(second.key)
    await expect(delegate([first, second])).rejects.toMatchObject({ status: 422 })
    expect(state.download).toHaveBeenCalledTimes(2)
    expect(state.delegate).not.toHaveBeenCalled()
  })

  it('refuses changed source bytes even though the stored source reference remains owned', async () => {
    const file = await owned()
    state.files.set(file.key, Buffer.from('changed object'))
    await expect(delegate([file])).rejects.toMatchObject({ status: 422 })
    expect(state.download).toHaveBeenCalledOnce()
    expect(state.delegate).not.toHaveBeenCalled()
  })

  it('decodes authenticated bytes at delivery instead of trusting a matching digest or magic header alone', async () => {
    const file = await owned()
    const damaged = Buffer.from(png)
    damaged[damaged.indexOf(Buffer.from('IDAT')) + 5] ^= 255
    state.files.set(file.key, damaged)
    // Internal isolated signer fixture exercises media validity separately from source ownership.
    const proof = await signCopilotSource({
      actorUserId: 'owner',
      key: file.key,
      filename: file.filename,
      mediaType: 'image/png',
      size: damaged.length,
      sha256: digest(damaged),
    })
    await expect(delegate([{ ...file, sourceProof: proof.sourceProof }])).rejects.toMatchObject({
      status: 415,
    })
    expect(state.download).toHaveBeenCalledOnce()
    expect(state.delegate).not.toHaveBeenCalled()
  })

  it('preserves cancellation after the first authorized read and does not read the next source', async () => {
    const first = await owned()
    const second = await owned(svg, 'image/svg+xml')
    const controller = new AbortController()
    const reason = new Error('Caller cancelled media delivery')
    state.download.mockImplementationOnce(async () => {
      controller.abort(reason)
      return Buffer.from(png)
    })
    await expect(delegate([first, second], scope, controller.signal)).rejects.toBe(reason)
    expect(state.download).toHaveBeenCalledOnce()
    expect(state.delegate).not.toHaveBeenCalled()
  })

  it('refuses an already cancelled delivery before any authorization read or delegation', async () => {
    const file = await owned()
    const controller = new AbortController()
    const reason = new Error('Caller cancelled before delivery')
    controller.abort(reason)
    await expect(delegate([file], scope, controller.signal)).rejects.toBe(reason)
    expect(state.download).not.toHaveBeenCalled()
    expect(state.delegate).not.toHaveBeenCalled()
  })
})
