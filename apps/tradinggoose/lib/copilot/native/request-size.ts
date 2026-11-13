import type { ChatContext } from '@/lib/copilot/chat-context-schema'
import type { CopilotRequest } from './contract'
import { NativeTargetError } from './errors'

// Next.js proxies buffer at most 10 MiB by default, including the complete JSON envelope.
export const MAX_COPILOT_REQUEST_BYTES = 10 * 1024 * 1024
const encoder = new TextEncoder()

function assertRequestBytes(bytes: number): void {
  if (bytes > MAX_COPILOT_REQUEST_BYTES)
    throw new NativeTargetError(
      'Copilot requests must fit within 10 MiB. Remove images or shorten the message and context.',
      413
    )
}

export function assertCopilotRequestSize(body: string): void {
  assertRequestBytes(encoder.encode(body).byteLength)
}

export function serializeCopilotRequest(command: CopilotRequest): string {
  const body = JSON.stringify(command)
  assertCopilotRequestSize(body)
  return body
}

/** Reserve encoded bytes before reading images; final command serialization includes its envelope. */
export function assertCopilotAttachmentSize(
  draft: { text: string; contexts: readonly ChatContext[] },
  images: readonly { size: number; type: string; data?: string }[]
): void {
  let pendingBytes = 0
  const content = [
    { type: 'text', text: draft.text },
    ...images.map((image) => {
      if (image.data === undefined) pendingBytes += 4 * Math.ceil(image.size / 3)
      return {
        type: 'image',
        image: image.data ?? `data:${image.type};base64,`,
        mediaType: image.type,
      }
    }),
  ]
  assertRequestBytes(
    encoder.encode(JSON.stringify({ content, contexts: draft.contexts })).byteLength + pendingBytes
  )
}

/** Enforce the same budget on raw bytes, including whitespace and fields rejected by the schema. */
export async function readCopilotRequestBody(request: Request): Promise<unknown> {
  assertRequestBytes(Number(request.headers.get('content-length')))
  if (!request.body) throw new SyntaxError('Copilot request body is empty')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      assertRequestBytes(bytes)
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return JSON.parse(chunks.join(''))
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}
