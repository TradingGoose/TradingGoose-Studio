import type { MessageInput } from '@mastra/core/agent/message-list'
import { resolveAuthorizedWorkspaceFileReference } from '@/lib/uploads/contexts/workspace'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import {
  assertStorageReferenceAccess,
  fetchPublicStorageUrl,
  StorageAccessError,
} from '@/lib/uploads/utils/file-utils'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

type MediaAuthority = { actorUserId?: string; workspaceId?: string; signal: AbortSignal }
const invalid = (message: string) => Object.assign(new Error(message), { status: 400 })

function inlineBytes(data: unknown): Buffer {
  if (
    typeof data !== 'string' ||
    !data ||
    data.length > Math.ceil(MAX_FILE_SIZE / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw invalid('Media must contain base64 data within the upload size limit')
  const bytes = Buffer.from(data, 'base64')
  if (
    !bytes.length ||
    bytes.length > MAX_FILE_SIZE ||
    bytes.toString('base64').replace(/=+$/, '') !== data.replace(/=+$/, '')
  )
    throw invalid('Invalid media data')
  return bytes
}

async function mediaData(
  value: unknown,
  authority: MediaAuthority,
  kind: 'image' | 'file'
): Promise<unknown> {
  authority.signal.throwIfAborted()
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    if (!value.byteLength || value.byteLength > MAX_FILE_SIZE) throw invalid('Invalid media size')
    return value
  }
  if (value instanceof URL) value = value.toString()
  if (typeof value !== 'string') throw invalid('Invalid media source')
  if (value.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value)
    if (!match) throw invalid('Media must use base64 data URLs')
    if (kind === 'image' && !match[1].startsWith('image/'))
      throw invalid('Image data must use an image media type')
    inlineBytes(match[2])
    return value
  }
  if (!/^https?:/i.test(value) && !value.startsWith('/api/files/serve/')) return inlineBytes(value)
  assertStorageReferenceAccess(value)
  const file = await resolveAuthorizedWorkspaceFileReference(value, authority.actorUserId)
  if (file) {
    if (authority.workspaceId && authority.workspaceId !== file.workspaceId)
      throw new StorageAccessError()
    return downloadFile({ key: file.key, context: 'workspace' })
  }
  if (!/^https?:\/\//i.test(value)) throw invalid('Media requires an absolute URL or inline data')
  const response = await fetchPublicStorageUrl(value, { signal: authority.signal })
  if (!response.ok) {
    await response.body?.cancel()
    throw invalid(`Media download failed (${response.status})`)
  }
  if (
    kind === 'image' &&
    !response.headers.get('content-type')?.toLowerCase().startsWith('image/')
  ) {
    await response.body?.cancel()
    throw invalid('Image download must have an image content type')
  }
  const reader = response.body?.getReader()
  if (!reader) throw invalid('Media body is empty')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      authority.signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_FILE_SIZE) throw invalid('Media exceeds the upload size limit')
      chunks.push(value)
    }
    if (!size) throw invalid('Media body is empty')
    return Buffer.concat(chunks, size)
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

/** Studio accepts the documented role/content message form; Mastra owns conversion and persistence. */
export async function normalizeNativeMediaMessages(
  messages: MessageInput[],
  authority: MediaAuthority
): Promise<MessageInput[]> {
  return Promise.all(
    messages.map(async (message: any) => {
      if (
        !message ||
        typeof message !== 'object' ||
        (!Array.isArray(message.content) && typeof message.content !== 'string')
      )
        throw invalid('Messages must use role/content with native content parts')
      if (typeof message.content === 'string') return message
      const content = []
      for (const part of message.content) {
        if (part.type === 'image')
          content.push({ ...part, image: await mediaData(part.image, authority, 'image') })
        else if (part.type === 'file')
          content.push({ ...part, data: await mediaData(part.data, authority, 'file') })
        else content.push(part)
      }
      return { ...message, content }
    })
  )
}

/** MCP image and audio content is base64 according to the protocol; the SDK handles its native projection. */
export async function normalizeNativeToolResult(
  value: any,
  authority: MediaAuthority
): Promise<any> {
  authority.signal.throwIfAborted()
  for (const part of Array.isArray(value?.content) ? value.content : [])
    if (part.type === 'image' || part.type === 'audio') inlineBytes(part.data)
  return value
}
