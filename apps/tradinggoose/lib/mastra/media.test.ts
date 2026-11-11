import { beforeEach, expect, it, vi } from 'vitest'
import { normalizeNativeMediaMessages, normalizeNativeToolResult } from './media'

const fixture = vi.hoisted(() => ({ resolve: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  resolveAuthorizedWorkspaceFileReference: fixture.resolve,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: fixture.download }))
vi.mock('@/lib/uploads/utils/validation', () => ({ MAX_FILE_SIZE: 64 }))
const authority = () => ({
  actorUserId: 'actor',
  workspaceId: 'workspace',
  signal: new AbortController().signal,
})
beforeEach(() => {
  vi.clearAllMocks()
  fixture.resolve.mockResolvedValue(null)
})
it('keeps canonical inline image parts beside their text prompt', async () => {
  const input = [
    {
      role: 'user' as const,
      content: [
        { type: 'text', text: 'Look' },
        { type: 'image', image: 'data:image/png;base64,aW1hZ2U=', mediaType: 'image/png' },
      ],
    },
  ]
  expect(await normalizeNativeMediaMessages(input as any, authority())).toEqual(input)
})
it.each([
  { role: 'user', parts: [] },
  { role: 'user', content: { format: 2, parts: [] } },
])('refuses an application message in an alternate wire format', async (message) => {
  await expect(normalizeNativeMediaMessages([message] as any, authority())).rejects.toThrow(
    'role/content'
  )
})
it('reads workspace images from their authorized row and its storage context', async () => {
  fixture.resolve.mockResolvedValue({ key: 'workspace/file', workspaceId: 'workspace' })
  fixture.download.mockResolvedValue(Buffer.from('image'))
  const result = await normalizeNativeMediaMessages(
    [
      {
        role: 'user',
        content: [{ type: 'image', image: '/api/files/serve/workspace/file?context=workspace' }],
      },
    ] as any,
    authority()
  )
  expect((result[0] as any).content[0].image).toEqual(Buffer.from('image'))
  expect(fixture.download).toHaveBeenCalledWith({ key: 'workspace/file', context: 'workspace' })
  fixture.resolve.mockResolvedValue({ key: 'foreign/file', workspaceId: 'foreign' })
  await expect(
    normalizeNativeMediaMessages(
      [
        {
          role: 'user',
          content: [{ type: 'image', image: '/api/files/serve/foreign/file?context=workspace' }],
        },
      ] as any,
      authority()
    )
  ).rejects.toThrow('denied')
})
it('uses canonical MCP base64 image/audio content without a conversion layer', async () => {
  const result = {
    content: [
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
      { type: 'text', text: 'Result' },
    ],
  }
  expect(await normalizeNativeToolResult(result, authority())).toBe(result)
  await expect(
    normalizeNativeToolResult(
      { content: [{ type: 'image', data: 'https://files.example/image.png' }] },
      authority()
    )
  ).rejects.toThrow('base64')
})
it('rejects oversized inline data before model contact', async () => {
  await expect(
    normalizeNativeMediaMessages(
      [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: `data:image/png;base64,${Buffer.alloc(65).toString('base64')}`,
            },
          ],
        },
      ] as any,
      authority()
    )
  ).rejects.toThrow(/media/i)
})
