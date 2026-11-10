import type { MessageInput } from '@mastra/core/agent/message-list'
import { createLogger } from '@/lib/logs/console/logger'
import { assertPublicStorageInput, fetchPublicStorageUrl } from '@/lib/uploads/archive-boundary'
import {
  assertStorageReferenceAccess,
  PrivateSourceAccessError,
} from '@/lib/uploads/source-read-boundary'
import { isImageMimeType, MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

type MediaAuthority = {
  actorUserId?: string
  workspaceId?: string
  signal: AbortSignal
  sourceChecks?: Array<() => Promise<void>>
}
const logger = createLogger('NativeMedia')
const invalid = (message: string) => Object.assign(new Error(message), { status: 400 })

function bounded(bytes: Buffer): Buffer {
  if (!bytes.length || bytes.length > MAX_FILE_SIZE)
    throw invalid('Media must be nonempty and within the upload size limit')
  return bytes
}

function mime(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw invalid('Invalid media type')
  const type = value.split(';')[0].trim().toLowerCase()
  if (type === 'image/*') return undefined
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)) throw invalid('Invalid media type')
  return type
}

function checkedMime(actual: unknown, declared: unknown, image: boolean) {
  const responseValue = mime(actual)
  const declaredValue = mime(declared)
  const responseType = responseValue === 'application/octet-stream' ? undefined : responseValue
  const declaredType = declaredValue === 'application/octet-stream' ? undefined : declaredValue
  if (responseType && declaredType && responseType !== declaredType)
    throw invalid('Media type conflicts with the source')
  const type =
    responseType ?? declaredType ?? (image ? undefined : (responseValue ?? declaredValue))
  if (image && type && !isImageMimeType(type)) throw invalid('Expected image media')
  return type
}

/** Decode inline data locally: neither application nor native conversion needs an URL fetch. */
function percentBytes(value: string, limit = MAX_FILE_SIZE): Buffer {
  const output = Buffer.allocUnsafe(Math.min(limit, Buffer.byteLength(value)))
  let size = 0
  for (let offset = 0; offset < value.length; ) {
    if (value[offset] === '%') {
      if (!/^[a-f0-9]{2}$/i.test(value.slice(offset + 1, offset + 3)))
        throw invalid('Malformed inline media')
      if (size === limit) throw invalid('Media exceeds the upload size limit')
      output[size++] = Number.parseInt(value.slice(offset + 1, offset + 3), 16)
      offset += 3
    } else {
      const end = value.indexOf('%', offset)
      const text = value.slice(offset, end < 0 ? undefined : end)
      const bytes = Buffer.byteLength(text)
      if (size + bytes > limit) throw invalid('Media exceeds the upload size limit')
      output.write(text, size, bytes, 'utf8')
      size += bytes
      offset += text.length
    }
  }
  return output.subarray(0, size)
}

function base64Bytes(value: unknown): Buffer {
  if (typeof value !== 'string') throw invalid('Malformed inline media')
  const normalized = value.replace(/[\t\n\f\r ]/g, '')
  if (
    normalized.length > Math.ceil(MAX_FILE_SIZE / 3) * 4 ||
    normalized.length % 4 === 1 ||
    !/^[a-z0-9+/]*={0,2}$/i.test(normalized)
  )
    throw invalid('Malformed or oversized inline media')
  const bytes = bounded(Buffer.from(normalized, 'base64'))
  if (bytes.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, ''))
    throw invalid('Malformed inline media')
  return bytes
}

async function responseBytes(response: Response, signal: AbortSignal): Promise<Buffer> {
  const reader = response.body?.getReader()
  let cancellation: Promise<void> | undefined
  const abort = () => {
    cancellation = reader?.cancel(signal.reason)
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    if (!response.ok) throw invalid(`Media download failed (${response.status})`)
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_FILE_SIZE))
      throw invalid('Media exceeds the upload size limit')
    if (!reader) throw invalid('Media body is empty')
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) return bounded(Buffer.concat(chunks, size))
      size += part.value.byteLength
      if (size > MAX_FILE_SIZE) throw invalid('Media exceeds the upload size limit')
      chunks.push(part.value)
    }
  } finally {
    signal.removeEventListener('abort', abort)
    try {
      await (cancellation ?? reader?.cancel())
    } finally {
      reader?.releaseLock()
    }
  }
}

async function readMedia(
  value: unknown,
  declared: unknown,
  image: boolean,
  authority: MediaAuthority
): Promise<{ bytes: Buffer; mediaType?: string }> {
  authority.signal.throwIfAborted()
  if (value instanceof Uint8Array || value instanceof ArrayBuffer)
    return {
      bytes: bounded(Buffer.from(new Uint8Array(value))),
      mediaType: checkedMime(undefined, declared, image),
    }
  if (value instanceof URL) value = value.toString()
  if (typeof value !== 'string' || !value) throw invalid('Invalid native media source')
  if (/^data:/i.test(value)) {
    const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(value)
    if (!match) throw invalid('Malformed inline media')
    const inline = percentBytes(
      match[3],
      match[2] ? Math.ceil(MAX_FILE_SIZE / 3) * 4 + 4 : MAX_FILE_SIZE
    )
    return {
      bytes: bounded(match[2] ? base64Bytes(inline.toString('latin1')) : inline),
      mediaType: checkedMime(match[1], declared, image),
    }
  }
  if (!/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value))
    return { bytes: base64Bytes(value), mediaType: checkedMime(undefined, declared, image) }
  assertPublicStorageInput(value)
  const locator = new URL(value, 'https://media-reference.invalid')
  if (
    locator.pathname.startsWith('/api/files/serve/') &&
    locator.searchParams.get('context') === 'workspace'
  ) {
    if (!authority.actorUserId) throw new PrivateSourceAccessError()
    const { resolveAuthorizedWorkspaceFileReference } = await import(
      '@/lib/uploads/contexts/workspace'
    )
    const file = await resolveAuthorizedWorkspaceFileReference(value, authority.actorUserId)
    authority.signal.throwIfAborted()
    if (!file || (authority.workspaceId && authority.workspaceId !== file.workspaceId))
      throw new PrivateSourceAccessError()
    const reference = value
    authority.sourceChecks?.push(async () => {
      authority.signal.throwIfAborted()
      const current = await resolveAuthorizedWorkspaceFileReference(
        reference,
        authority.actorUserId
      )
      if (
        !current ||
        current.id !== file.id ||
        current.key !== file.key ||
        current.workspaceId !== file.workspaceId
      )
        throw new PrivateSourceAccessError()
      authority.signal.throwIfAborted()
    })
    const { downloadFileFromStorage } = await import('@/lib/uploads/utils/file-processing')
    const bytes = await downloadFileFromStorage(
      {
        ...file,
        url: value,
        uploadedAt: file.uploadedAt.toISOString(),
        expiresAt: '',
        context: 'workspace',
      },
      'native-media',
      logger,
      { ...authority, actorUserId: authority.actorUserId }
    )
    authority.signal.throwIfAborted()
    return { bytes: bounded(bytes), mediaType: checkedMime(file.type, declared, image) }
  }
  assertStorageReferenceAccess(value)
  if (!/^https?:\/\//i.test(value) || locator.username || locator.password)
    throw invalid('Unsupported media source')
  const response = await fetchPublicStorageUrl(value, { signal: authority.signal })
  try {
    const mediaType = checkedMime(response.headers.get('content-type'), declared, image)
    return { bytes: await responseBytes(response, authority.signal), mediaType }
  } catch (error) {
    if (!response.body?.locked) await response.body?.cancel()
    throw error
  }
}

/** Match only the selected converter's actual top-level MCP promotion shape. */
function hasMcpMediaResult(value: any): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray(value.content) &&
    value.content.some(
      (entry: any) =>
        entry &&
        typeof entry === 'object' &&
        (entry.type === 'image' || entry.type === 'audio') &&
        typeof entry.data === 'string'
    )
  )
}

async function projectMcpToolResult(
  value: any,
  authority: MediaAuthority,
  literal = false,
  unwrapValue = false
): Promise<any> {
  if (!value || typeof value !== 'object') return value
  if (unwrapValue && Object.keys(value).length === 1 && Object.hasOwn(value, 'value'))
    return { ...value, value: await projectMcpToolResult(value.value, authority, literal) }
  if (!hasMcpMediaResult(value)) return value
  const content = []
  for (const entry of value.content) {
    if (
      !entry ||
      (entry.type !== 'image' && entry.type !== 'audio') ||
      typeof entry.data !== 'string'
    ) {
      content.push(entry)
      continue
    }
    if (literal) {
      if (/^https?:\/\//i.test(entry.data)) {
        assertPublicStorageInput(entry.data)
        assertStorageReferenceAccess(entry.data)
      }
      base64Bytes(entry.data)
      content.push(entry)
    } else {
      const media = await readMedia(entry.data, entry.mimeType, entry.type === 'image', authority)
      content.push({
        ...entry,
        data: media.bytes.toString('base64'),
        ...(media.mediaType ? { mimeType: media.mediaType } : {}),
      })
    }
  }
  return literal ? value : { ...value, content }
}

/** Guard a live tool's native return copy; its raw application result remains unchanged. */
export async function normalizeNativeToolResult(
  value: any,
  requestAuthority: Omit<MediaAuthority, 'sourceChecks'>
): Promise<any> {
  if (!hasMcpMediaResult(value)) return value
  if (!requestAuthority?.signal || !requestAuthority.actorUserId?.trim())
    throw new PrivateSourceAccessError()
  const authority: MediaAuthority = { ...requestAuthority, sourceChecks: [] }
  authority.signal.throwIfAborted()
  const result = await projectMcpToolResult(value, authority)
  for (const check of authority.sourceChecks!) await check()
  authority.signal.throwIfAborted()
  return result
}

/** Only known native media positions are visited; business JSON/args/results stay literal. */
export async function normalizeNativeMediaMessages(
  messages: MessageInput[],
  requestAuthority: Omit<MediaAuthority, 'sourceChecks'>
): Promise<MessageInput[]> {
  const authority: MediaAuthority = { ...requestAuthority, sourceChecks: [] }
  if (!Array.isArray(messages)) throw invalid('Native messages must be an array')
  // These are the selected converter's MCP promotion sites, not arbitrary JSON recursion.
  const mcpResult = (value: any, literal = false, unwrapValue = false): Promise<any> =>
    projectMcpToolResult(value, authority, literal, unwrapValue)
  const parts = async (entries: any[], ui = false): Promise<any[]> => {
    if (!Array.isArray(entries)) throw invalid('Invalid native media parts')
    const result = []
    for (const original of entries) {
      authority.signal.throwIfAborted()
      let part = original
      const tool =
        typeof part?.type === 'string' &&
        (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
      if (tool) {
        const fields =
          part.type === 'tool-invocation'
            ? ['providerMetadata']
            : part.type === 'tool-result' || part.type === 'tool-call'
              ? ['providerOptions']
              : ['callProviderMetadata', 'resultProviderMetadata']
        for (const field of fields) {
          const metadata = part[field]
          const output = metadata?.mastra?.modelOutput
          if (
            metadata?.mastra &&
            Object.hasOwn(metadata.mastra, 'modelOutput') &&
            output?.type === 'content'
          )
            part = {
              ...part,
              [field]: {
                ...metadata,
                mastra: {
                  ...metadata.mastra,
                  modelOutput: { ...output, value: await parts(output.value) },
                },
              },
            }
        }
        const projected = fields.some(
          (field) =>
            part[field]?.mastra &&
            Object.hasOwn(part[field].mastra, 'modelOutput') &&
            part[field].mastra.modelOutput != null
        )
        if (
          !projected &&
          part.type === 'tool-invocation' &&
          part.toolInvocation?.state === 'result'
        )
          part = {
            ...part,
            toolInvocation: {
              ...part.toolInvocation,
              result: await mcpResult(part.toolInvocation.result),
            },
          }
        else if (!projected && part.state === 'output-available')
          part = { ...part, output: await mcpResult(part.output, false, true) }
        else if (!projected && part.type === 'tool-result' && part.output?.type === 'json')
          await mcpResult(part.output.value, true)
        else if (
          !projected &&
          part.type === 'tool-result' &&
          !part.output &&
          Object.hasOwn(part, 'result')
        )
          part = { ...part, result: await mcpResult(part.result) }
      }
      if (part?.type === 'image' || part?.type === 'file') {
        const image =
          part.type === 'image' ||
          String(part.mediaType ?? part.mimeType ?? '').startsWith('image/')
        const source =
          part.type === 'image' ? (part.image ?? part.data ?? part.url) : (part.data ?? part.url)
        const media = await readMedia(source, part.mediaType ?? part.mimeType, image, authority)
        const { url: _url, data: _data, image: _image, ...rest } = part
        if (ui) {
          if (!media.mediaType) throw invalid('Inline attachment requires a media type')
          result.push({
            ...rest,
            url: `data:${media.mediaType};base64,${media.bytes.toString('base64')}`,
            mediaType: media.mediaType,
          })
        } else {
          if (part.type === 'file' && !media.mediaType) throw invalid('File requires a media type')
          result.push({
            ...rest,
            [part.type === 'image' ? 'image' : 'data']: media.bytes,
            ...(media.mediaType ? { mediaType: media.mediaType, mimeType: media.mediaType } : {}),
          })
        }
      } else if (part?.type === 'image-url' || part?.type === 'file-url') {
        const media = await readMedia(
          part.url,
          part.mediaType,
          part.type === 'image-url',
          authority
        )
        if (!media.mediaType) throw invalid('Tool media requires a media type')
        const { url: _url, ...rest } = part
        result.push({
          ...rest,
          type: part.type === 'image-url' ? 'image-data' : 'file-data',
          data: media.bytes.toString('base64'),
          mediaType: media.mediaType,
        })
      } else if (part?.type === 'tool-result' && part.output?.type === 'content') {
        result.push({ ...part, output: { ...part.output, value: await parts(part.output.value) } })
      } else if (part?.type === 'tool-result' && Array.isArray(part.experimental_content)) {
        const content = []
        for (const entry of part.experimental_content) {
          if (entry.type !== 'image') content.push(entry)
          else {
            const media = await readMedia(entry.data, entry.mimeType, true, authority)
            content.push({
              ...entry,
              data: media.bytes.toString('base64'),
              mimeType: media.mediaType,
            })
          }
        }
        result.push({ ...part, experimental_content: content })
      } else if (part?.type === 'media') {
        const media = await readMedia(
          part.data,
          part.mediaType,
          String(part.mediaType ?? '').startsWith('image/'),
          authority
        )
        if (!media.mediaType) throw invalid('Tool media requires a media type')
        const { url: _url, image: _image, ...rest } = part
        result.push({ ...rest, data: media.bytes.toString('base64'), mediaType: media.mediaType })
      } else if (part?.type === 'image-data' || part?.type === 'file-data') {
        const bytes = base64Bytes(part.data)
        const type = checkedMime(undefined, part.mediaType, part.type === 'image-data')
        if (!type) throw invalid('Tool media requires a media type')
        result.push({ ...part, data: bytes.toString('base64'), mediaType: type })
      } else result.push(part)
    }
    return result
  }
  const attachments = async (entries: any[]) => {
    const attachments = []
    for (const attachment of entries) {
      const media = await readMedia(
        attachment.url,
        attachment.contentType,
        String(attachment.contentType ?? '').startsWith('image/'),
        authority
      )
      if (!media.mediaType) throw invalid('Attachment requires a media type')
      attachments.push({
        ...attachment,
        contentType: media.mediaType,
        url: `data:${media.mediaType};base64,${media.bytes.toString('base64')}`,
      })
    }
    return attachments
  }
  const invocations = async (entries: any[]) => {
    const result = []
    for (const invocation of entries)
      result.push(
        invocation?.state === 'result'
          ? { ...invocation, result: await mcpResult(invocation.result) }
          : invocation
      )
    return result
  }
  const result: MessageInput[] = []
  for (const message of messages) {
    let value: any = message
    if (Array.isArray(value?.content)) value = { ...value, content: await parts(value.content) }
    else if (Array.isArray(value?.content?.parts))
      value = {
        ...value,
        content: { ...value.content, parts: await parts(value.content.parts, true) },
      }
    if (Array.isArray(value?.parts)) value = { ...value, parts: await parts(value.parts, true) }
    if (Array.isArray(value?.toolInvocations) && Array.isArray(value?.parts))
      value = { ...value, toolInvocations: await invocations(value.toolInvocations) }
    if (value?.content?.format === 2 && Array.isArray(value.content.toolInvocations))
      value = {
        ...value,
        content: {
          ...value.content,
          toolInvocations: await invocations(value.content.toolInvocations),
        },
      }

    if (Array.isArray(value?.experimental_attachments))
      value = {
        ...value,
        experimental_attachments: await attachments(value.experimental_attachments),
      }
    if (Array.isArray(value?.content?.experimental_attachments))
      value = {
        ...value,
        content: {
          ...value.content,
          experimental_attachments: await attachments(value.content.experimental_attachments),
        },
      }
    result.push(value)
  }
  for (const check of authority.sourceChecks!) await check()
  authority.signal.throwIfAborted()
  return result
}
