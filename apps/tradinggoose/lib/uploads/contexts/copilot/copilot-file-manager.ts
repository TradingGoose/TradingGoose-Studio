import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import type { FileInfo } from '@/lib/uploads/core/storage-client'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import { withAuthorizedStorageRead } from '@/lib/uploads/source-read-boundary'
import {
  type CopilotSourceClaims,
  CopilotSourceError,
  signCopilotSource,
  verifyCopilotSource,
} from './source-proof'

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])
export const isSupportedFileType = (mimeType: string) =>
  SUPPORTED_IMAGE_TYPES.has(mimeType.toLowerCase())
export const isImageFileType = (mimeType: string) => mimeType.toLowerCase().startsWith('image/')
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
const descriptorSchema = z
  .object({
    key: z.string().min(1),
    sourceProof: z.string().min(1),
    filename: z.string().optional(),
    media_type: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
  })
  .strict()
export type CopilotFileAttachment = z.infer<typeof descriptorSchema>
export type CopilotAttachmentScope = { actorUserId: string; workspaceId: string | null }

async function validateImage(buffer: Buffer, mediaType: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  let valid = false
  switch (mediaType) {
    case 'image/png':
      valid = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      break
    case 'image/jpeg':
    case 'image/jpg':
      valid = buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
      break
    case 'image/gif':
      valid = ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
      break
    case 'image/webp':
      valid =
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      break
    case 'image/svg+xml': {
      const text = buffer
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .trim()
        .replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
        .replace(/^(?:<!--[\s\S]*?-->\s*)+/, '')
      valid = /^<svg(?:\s|>)/i.test(text) && /(?:<\/svg\s*>|\/>)\s*$/i.test(text)
      break
    }
  }
  if (!buffer.length || !valid)
    throw new CopilotSourceError(
      'Attachment media is empty, unsupported or does not match its image type',
      415
    )
  try {
    await sharp(buffer, { failOn: 'warning', animated: true }).stats()
  } catch {
    signal?.throwIfAborted()
    throw new CopilotSourceError(
      'Attachment image could not be decoded; upload a complete supported image again',
      415
    )
  }
  signal?.throwIfAborted()
}

/** Authenticated completion only: actual new allocation, immutable write and exact readback. */
export async function uploadCopilotFile(input: {
  actorUserId: string
  buffer: Buffer
  filename: string
  mediaType: string
  signal?: AbortSignal
}): Promise<FileInfo & { sourceProof: string; expiresAt: string }> {
  if (!input.actorUserId.trim())
    throw new CopilotSourceError('Authenticated image upload is required', 401)
  input.signal?.throwIfAborted()
  const mediaType = input.mediaType.toLowerCase()
  await validateImage(input.buffer, mediaType, input.signal)
  const key = `copilot/${randomUUID()}-${input.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const file = await uploadFile({
    file: input.buffer,
    fileName: input.filename,
    contentType: mediaType,
    context: 'copilot',
    customKey: key,
    preserveKey: true,
    preventOverwrite: true,
  })
  input.signal?.throwIfAborted()
  if (file.key !== key) throw new CopilotSourceError('Image allocation could not be verified', 503)
  const stored = await withAuthorizedStorageRead(key, 'copilot', () =>
    downloadFile({ key, context: 'copilot' })
  )
  input.signal?.throwIfAborted()
  if (stored.length !== input.buffer.length || digest(stored) !== digest(input.buffer))
    throw new CopilotSourceError('Stored image readback could not be verified', 503)
  await validateImage(stored, mediaType, input.signal)
  const proof = await signCopilotSource({
    actorUserId: input.actorUserId,
    key,
    filename: input.filename,
    mediaType,
    size: stored.length,
    sha256: digest(stored),
  })
  return { ...file, name: input.filename, type: mediaType, ...proof }
}

/** Every descriptor and the actual conversation scope authorize before the first byte read. */
export async function authorizeCopilotAttachments(
  attachments: CopilotFileAttachment[],
  scope: CopilotAttachmentScope,
  signal?: AbortSignal
): Promise<CopilotSourceClaims[]> {
  signal?.throwIfAborted()
  if (!scope.actorUserId?.trim())
    throw new CopilotSourceError('Authenticated attachment actor is required', 401)
  if (scope.workspaceId !== null) {
    if (typeof scope.workspaceId !== 'string' || !scope.workspaceId.trim())
      throw new CopilotSourceError('Invalid conversation workspace', 400)
    if (!(await checkWorkspaceAccess(scope.workspaceId, scope.actorUserId)).hasAccess)
      throw new CopilotSourceError('Conversation workspace access denied')
  }
  const parsed = z.array(descriptorSchema).safeParse(attachments)
  if (!parsed.success)
    throw new CopilotSourceError(
      'Attachment source authorization is missing or invalid; upload the image again'
    )
  const descriptors = parsed.data
  const sources: CopilotSourceClaims[] = []
  for (const descriptor of descriptors) {
    signal?.throwIfAborted()
    const source = await verifyCopilotSource(descriptor.sourceProof)
    if (
      source.actorUserId !== scope.actorUserId ||
      source.key !== descriptor.key ||
      (descriptor.filename !== undefined && descriptor.filename !== source.filename) ||
      (descriptor.media_type !== undefined && descriptor.media_type !== source.mediaType) ||
      (descriptor.size !== undefined && descriptor.size !== source.size)
    )
      throw new CopilotSourceError('Attachment is unavailable or not owned by this actor')
    if (!isSupportedFileType(source.mediaType))
      throw new CopilotSourceError('Attachment media type is unsupported', 415)
    sources.push(source)
  }
  signal?.throwIfAborted()
  return sources
}

export async function processCopilotAttachments(
  attachments: CopilotFileAttachment[],
  scope: CopilotAttachmentScope,
  _requestId: string,
  signal?: AbortSignal
): Promise<
  Array<{
    buffer: Buffer
    attachment: { key: string; filename: string; media_type: string; size: number }
  }>
> {
  const sources = await authorizeCopilotAttachments(attachments, scope, signal)
  const result: Array<{
    buffer: Buffer
    attachment: { key: string; filename: string; media_type: string; size: number }
  }> = []
  for (const source of sources) {
    signal?.throwIfAborted()
    if (source.exp <= Math.floor(Date.now() / 1000))
      throw new CopilotSourceError('Attachment authorization expired; upload the image again')
    let buffer: Buffer
    try {
      buffer = await withAuthorizedStorageRead(source.key, 'copilot', () =>
        downloadFile({ key: source.key, context: 'copilot' })
      )
    } catch {
      throw new CopilotSourceError('Attachment could not be read; upload the image again', 422)
    }
    signal?.throwIfAborted()
    if (
      source.exp <= Math.floor(Date.now() / 1000) ||
      buffer.length !== source.size ||
      digest(buffer) !== source.sha256
    )
      throw new CopilotSourceError(
        'Attachment bytes or authorization changed; upload the image again',
        422
      )
    await validateImage(buffer, source.mediaType, signal)
    if (source.exp <= Math.floor(Date.now() / 1000))
      throw new CopilotSourceError('Attachment authorization expired; upload the image again', 422)
    result.push({
      buffer,
      attachment: {
        key: source.key,
        filename: source.filename,
        media_type: source.mediaType,
        size: source.size,
      },
    })
  }
  return result
}
