import { describe, expect, it } from 'vitest'
import {
  assertCopilotAttachmentSize,
  MAX_COPILOT_REQUEST_BYTES,
  serializeCopilotRequest,
} from './request-size'

describe('Copilot request byte budget', () => {
  it('includes UTF-8, escaped JSON, contexts, inline data and the complete command envelope', () => {
    const command = {
      command: 'message' as const,
      workspaceId: 'workspace',
      threadId: 'thread',
      toolContext: { workspaceId: 'workspace' },
      model: 'provider/model',
      input: {
        content: [
          { type: 'text' as const, text: '🦆 "quoted"\n' },
          {
            type: 'image' as const,
            mediaType: 'image/png',
            image: 'data:image/png;base64,aW1hZ2U=',
          },
        ],
        contexts: [{ kind: 'docs' as const, label: '文档\\docs' }],
      },
    }
    const part = command.input.content[0]
    if (part.type !== 'text') throw new Error('Missing text fixture')
    const remaining = MAX_COPILOT_REQUEST_BYTES - Buffer.byteLength(JSON.stringify(command))
    part.text += 'a'.repeat(remaining)
    const body = serializeCopilotRequest(command)
    expect(Buffer.byteLength(body)).toBe(MAX_COPILOT_REQUEST_BYTES)
    expect(JSON.parse(body)).toEqual(command)
    part.text += 'a'
    expect(() => serializeCopilotRequest(command)).toThrowError(
      expect.objectContaining({ status: 413 })
    )
  })

  it('reserves base64 expansion across all unread images before allocating their data', () => {
    const draft = { text: 'Describe', contexts: [] }
    const file = (size: number) => ({ size, type: 'image/png' })
    expect(() => assertCopilotAttachmentSize(draft, [file(8 * 1024 * 1024)])).toThrow()
    expect(() => assertCopilotAttachmentSize(draft, [file(4 * 1024 * 1024)])).not.toThrow()
    expect(() =>
      assertCopilotAttachmentSize(draft, [file(4 * 1024 * 1024), file(4 * 1024 * 1024)])
    ).toThrow()
  })

  it('checks actual ready data and leaves final envelope admission to the exact serializer', () => {
    const draft = { text: 'Describe', contexts: [] }
    const image = { size: 1, type: 'image/png', data: 'data:image/png;base64,' }
    const input = {
      content: [
        { type: 'text' as const, text: draft.text },
        { type: 'image' as const, image: image.data, mediaType: image.type },
      ],
      contexts: [],
    }
    const remaining = MAX_COPILOT_REQUEST_BYTES - Buffer.byteLength(JSON.stringify(input))
    image.data += 'A'.repeat(remaining)
    input.content[1] = { type: 'image', image: image.data, mediaType: image.type }
    expect(() => assertCopilotAttachmentSize(draft, [image])).not.toThrow()
    expect(() =>
      serializeCopilotRequest({ command: 'message', workspaceId: null, model: 'model', input })
    ).toThrowError(expect.objectContaining({ status: 413 }))
    image.data += 'A'
    expect(() => assertCopilotAttachmentSize(draft, [image])).toThrow()
  })
})
