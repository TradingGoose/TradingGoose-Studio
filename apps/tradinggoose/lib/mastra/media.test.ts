import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ resolve: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/uploads/core/setup', () => ({ getStorageProvider: () => 's3' }))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: () => ({ bucket: 'private-source', region: 'source' }),
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({
  resolveAuthorizedWorkspaceFileReference: state.resolve,
}))
vi.mock('@/lib/uploads/utils/file-processing', () => ({ downloadFileFromStorage: state.download }))

import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { normalizeNativeMediaMessages } from './media'

const bytes = Buffer.from('actual image bytes')
const canonical =
  '/api/files/serve/workspace/image.png?context=workspace&workspaceId=workspace&fileId=file'
const row = {
  id: 'file',
  workspaceId: 'workspace',
  key: 'workspace/image.png',
  name: 'image.png',
  type: 'image/png',
  size: bytes.length,
  uploadedAt: new Date(0),
}
const authority = (signal = new AbortController().signal) => ({
  actorUserId: 'reader',
  workspaceId: 'workspace',
  signal,
})
const image = (url: string) => ({
  role: 'user' as const,
  content: [{ type: 'image' as const, image: url }],
})
const response = () =>
  new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } })

beforeEach(() => {
  vi.clearAllMocks()
  state.resolve.mockResolvedValue(row)
  state.download.mockResolvedValue(bytes)
})
afterEach(() => vi.unstubAllGlobals())

describe('guarded native media bytes before conversion', () => {
  it.each([
    '/api/files/serve/raw.png?context=copilot',
    '/api/files/serve/%252fworkflow-archive',
    'https://private-source.s3.amazonaws.com/flat.png',
    'https://public.fixture/archived-enhanced-logs/original.json',
  ])('refuses protected original %s before fetch/storage', async (url) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(normalizeNativeMediaMessages([image(url)], authority())).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    expect(state.download).not.toHaveBeenCalled()
  })

  it('normalizes public image/file and tool media while preserving literal business JSON and ordering', async () => {
    const fetcher = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const business = {
      type: 'image-url',
      url: '/api/files/serve/private?context=copilot',
      cost: 9999,
    }
    const messages: any[] = [
      { role: 'system', content: '' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '  literal  ' },
          { type: 'image', image: 'https://public.fixture/image' },
          {
            type: 'file',
            data: 'data:text/plain;base64,aGVsbG8=',
            mediaType: 'text/plain',
            filename: 'a.txt',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call',
            toolName: 'tool',
            output: {
              type: 'content',
              value: [
                { type: 'text', text: 'ordered' },
                { type: 'image-url', url: 'https://public.fixture/tool' },
              ],
            },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'json',
            toolName: 'tool',
            output: { type: 'json', value: business },
          },
          {
            type: 'tool-result',
            toolCallId: 'file',
            toolName: 'tool',
            output: {
              type: 'content',
              value: [
                {
                  type: 'file-url',
                  url: 'https://public.fixture/file',
                  mediaType: 'image/png',
                  filename: 'tool.png',
                },
              ],
            },
          },
        ],
      },
    ]
    const result: any = await normalizeNativeMediaMessages(messages, authority())
    expect(result.map((entry: any) => entry.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(result[0]).toBe(messages[0])
    expect(result[1].content[0]).toBe(messages[1].content[0])
    expect(result[1].content[1]).toMatchObject({ image: bytes, mediaType: 'image/png' })
    expect(result[1].content[2]).toMatchObject({
      data: Buffer.from('hello'),
      filename: 'a.txt',
      mediaType: 'text/plain',
    })
    expect(result[2].content[0].output.value[1]).toMatchObject({
      type: 'image-data',
      data: bytes.toString('base64'),
      mediaType: 'image/png',
    })
    expect(result[3].content[0].output.value).toBe(business)
    expect(result[3].content[1].output.value[0]).toMatchObject({
      type: 'file-data',
      data: bytes.toString('base64'),
      filename: 'tool.png',
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    for (const [, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.redirect).toBe('manual')
      expect(init.headers).toBeUndefined()
      expect(init.signal).toBeInstanceOf(AbortSignal)
    }
    expect(messages[1].content[1].image).toBe('https://public.fixture/image')
  })

  it('uses existing canonical authorization and narrow helper, never self-HTTP', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const auth = authority()
    const result: any = await normalizeNativeMediaMessages([image(canonical)], auth)
    expect(result[0].content[0].image).toEqual(bytes)
    expect(state.resolve).toHaveBeenCalledWith(canonical, 'reader')
    expect(state.download).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file', key: row.key, url: canonical, context: 'workspace' }),
      'native-media',
      expect.anything(),
      expect.objectContaining(auth)
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rechecks earlier canonical authority after other awaited media reads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        state.resolve.mockRejectedValueOnce(new Error('Revoked during later read'))
        return response()
      })
    )
    await expect(
      normalizeNativeMediaMessages(
        [image(canonical), image('https://public.fixture/later')],
        authority()
      )
    ).rejects.toThrow('Revoked')
    expect(state.download).toHaveBeenCalledTimes(1)
  })

  it.each(['other-workspace', undefined])(
    'refuses foreign or missing canonical requester authority %s',
    async (workspace) => {
      const auth = workspace
        ? { ...authority(), workspaceId: workspace }
        : { ...authority(), actorUserId: undefined }
      await expect(normalizeNativeMediaMessages([image(canonical)], auth)).rejects.toThrow('access')
      expect(state.download).not.toHaveBeenCalled()
    }
  )

  it('cancels the first redirect body and refuses its private destination before target contact', async () => {
    const cancel = vi.fn()
    const fetcher = vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          status: 302,
          headers: { location: '/api/files/serve/flat?context=copilot' },
        })
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(
      normalizeNativeMediaMessages([image('https://public.fixture/start')], authority())
    ).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each<ResponseInit>([
    { headers: { 'content-type': 'text/plain' }, status: 200 },
    {
      headers: { 'content-type': 'image/png', 'content-length': String(MAX_FILE_SIZE + 1) },
      status: 200,
    },
    { headers: { 'content-type': 'image/png' }, status: 404 },
  ])('cancels rejected final bodies (%j)', async (init) => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ReadableStream({ cancel }), init))
    )
    await expect(
      normalizeNativeMediaMessages([image('https://public.fixture/final')], authority())
    ).rejects.toThrow()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('bounds actual cumulative stream bytes with no partial result or later media fetch', async () => {
    const chunk = new Uint8Array(8192)
    let pulls = 0
    const cancel = vi.fn()
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulls++
              controller.enqueue(chunk)
            },
            cancel,
          }),
          { headers: { 'content-type': 'image/png' } }
        )
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(
      normalizeNativeMediaMessages(
        [image('https://public.fixture/oversized'), image('https://public.fixture/later')],
        authority()
      )
    ).rejects.toThrow('size limit')
    expect(pulls * chunk.byteLength).toBeGreaterThan(MAX_FILE_SIZE)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending final body on owned abort and refuses later work', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream(
            {
              pull() {
                controller.abort(new DOMException('Canceled body', 'AbortError'))
              },
              cancel,
            },
            { highWaterMark: 0 }
          ),
          { headers: { 'content-type': 'image/png' } }
        )
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(
      normalizeNativeMediaMessages(
        [image('https://public.fixture/pending')],
        authority(controller.signal)
      )
    ).rejects.toThrow('Canceled body')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('refuses pre-aborted inputs without any fetch', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    controller.abort(new Error('Already canceled'))
    await expect(
      normalizeNativeMediaMessages(
        [image('https://public.fixture/image')],
        authority(controller.signal)
      )
    ).rejects.toThrow('Already canceled')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps native DB/UI inline attachments and binary percent-data local', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const input: any = [
      {
        id: 'db',
        role: 'user',
        content: {
          format: 2,
          parts: [{ type: 'file', url: 'DATA:image/png;BASE64,eA==', mediaType: 'image/png' }],
        },
      },
      {
        id: 'ui',
        role: 'user',
        parts: [{ type: 'file', url: 'data:image/png,%89PNG', mediaType: 'image/png' }],
      },
      {
        id: 'v4',
        role: 'user',
        content: 'text',
        experimental_attachments: [
          { url: 'data:text/plain,hello%20world', contentType: 'text/plain', name: 'a.txt' },
        ],
      },
    ]
    const result: any = await normalizeNativeMediaMessages(input, authority())
    expect(result[0].content.parts[0].url).toBe('data:image/png;base64,eA==')
    expect(result[1].parts[0].url).toBe(
      `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString('base64')}`
    )
    expect(result[2].experimental_attachments[0].url).toBe(
      `data:text/plain;base64,${Buffer.from('hello world').toString('base64')}`
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('guards nested native DB attachments before conversion and keeps public bytes local', async () => {
    const fetcher = vi.fn(
      async () => new Response('verified', { headers: { 'content-type': 'image/png' } })
    )
    vi.stubGlobal('fetch', fetcher)
    const db = (url: string): any => ({
      id: 'db-attachment',
      role: 'user',
      content: {
        format: 2,
        parts: [{ type: 'text', text: 'x' }],
        experimental_attachments: [{ url, contentType: 'image/png' }],
      },
    })
    await expect(
      normalizeNativeMediaMessages([db('/api/files/serve/raw?context=copilot')], authority())
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    const [out]: any = await normalizeNativeMediaMessages(
      [db('https://public.fixture/nested')],
      authority()
    )
    expect(out.content.experimental_attachments[0].url).toBe(
      `data:image/png;base64,${Buffer.from('verified').toString('base64')}`
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('removes original alternate native media aliases after guarding their selected source', async () => {
    const fetcher = vi.fn(
      async () => new Response('verified', { headers: { 'content-type': 'image/png' } })
    )
    vi.stubGlobal('fetch', fetcher)
    const input: any = [
      {
        role: 'user',
        content: {
          format: 2,
          parts: [
            {
              type: 'file',
              data: 'https://public.fixture/selected',
              url: '/api/files/serve/other?context=copilot',
              mimeType: 'image/png',
            },
          ],
        },
      },
    ]
    const [out]: any = await normalizeNativeMediaMessages(input, authority())
    expect(out.content.parts[0]).not.toHaveProperty('data')
    expect(out.content.parts[0]).not.toHaveProperty('image')
    expect(out.content.parts[0].url).toBe(
      `data:image/png;base64,${Buffer.from('verified').toString('base64')}`
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('selected tool semantic media slots', () => {
  const protectedUrl = 'https://private.fixture/api/files/serve/raw.png?context=copilot'
  function metadataMessage(
    field: string,
    url: string,
    value: unknown = [{ type: 'image-url', url }]
  ): any {
    const business = { url: protectedUrl, tokens: 9999 }
    const metadata = {
      fixture: { signature: 'preserved' },
      mastra: { unrelated: 'preserved', modelOutput: { type: 'content', value } },
    }
    if (field === 'providerMetadata')
      return {
        id: 'db-slot',
        role: 'assistant',
        content: {
          format: 2,
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: {
                state: 'result',
                toolCallId: 'call',
                toolName: 'inspect',
                args: business,
                result: business,
              },
              [field]: metadata,
            },
          ],
        },
      }
    if (field === 'providerOptions')
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call',
            toolName: 'inspect',
            output: { type: 'json', value: business },
            [field]: metadata,
          },
        ],
      }
    return {
      id: 'ui-slot',
      role: 'assistant',
      parts: [
        {
          type: 'tool-inspect',
          state: 'output-available',
          toolCallId: 'call',
          input: business,
          output: business,
          [field]: metadata,
        },
      ],
    }
  }
  const slot = (message: any) =>
    message.content?.parts?.[0] ?? message.parts?.[0] ?? message.content[0]
  it.each([
    'providerMetadata',
    'providerOptions',
    'callProviderMetadata',
    'resultProviderMetadata',
  ])(
    'guards %s modelOutput before any source contact and preserves other fields',
    async (field) => {
      const fetcher = vi.fn(async () => response())
      vi.stubGlobal('fetch', fetcher)
      await expect(
        normalizeNativeMediaMessages([metadataMessage(field, protectedUrl)], authority())
      ).rejects.toMatchObject({ status: 403 })
      expect(fetcher).not.toHaveBeenCalled()
      const original = metadataMessage(field, 'https://public.fixture/tool-slot')
      const before = JSON.parse(JSON.stringify(original))
      const [normalized]: any = await normalizeNativeMediaMessages([original], authority())
      const part = slot(normalized)
      expect(part[field]).toMatchObject({
        fixture: { signature: 'preserved' },
        mastra: {
          unrelated: 'preserved',
          modelOutput: {
            type: 'content',
            value: [{ type: 'image-data', data: bytes.toString('base64'), mediaType: 'image/png' }],
          },
        },
      })
      const oldPart = slot(original)
      expect(part.toolInvocation?.args ?? part.input ?? part.output.value).toEqual(
        oldPart.toolInvocation?.args ?? oldPart.input ?? oldPart.output.value
      )
      expect(original).toEqual(before)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )
  it.each([null, {}, 'not-an-array'])(
    'refuses a malformed semantic content.value %j before source contact',
    async (bad) => {
      const fetcher = vi.fn()
      vi.stubGlobal('fetch', fetcher)
      await expect(
        normalizeNativeMediaMessages([metadataMessage('providerMetadata', '', bad)], authority())
      ).rejects.toMatchObject({ status: 400 })
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
  it('guards the authored v5 media.data URL before native URL healing', async () => {
    const fetcher = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const message = (data: string): any => ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call',
          toolName: 'inspect',
          output: { type: 'content', value: [{ type: 'media', data, mediaType: 'image/png' }] },
        },
      ],
    })
    await expect(
      normalizeNativeMediaMessages([message(protectedUrl)], authority())
    ).rejects.toMatchObject({ status: 403 })
    expect(fetcher).not.toHaveBeenCalled()
    const [normalized]: any = await normalizeNativeMediaMessages(
      [message('https://public.fixture/v5-media')],
      authority()
    )
    expect(normalized.content[0].output.value[0]).toEqual({
      type: 'media',
      data: bytes.toString('base64'),
      mediaType: 'image/png',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['db', 'db-invocations', 'ui', 'dynamic', 'v4'])(
    'normalizes only actual %s MCP result media, preserving text/args/result fields',
    async (format) => {
      const fetcher = vi.fn(async () => response())
      vi.stubGlobal('fetch', fetcher)
      const result = {
        business: { url: protectedUrl },
        content: [
          { type: 'text', text: 'literal' },
          { type: 'image', data: 'https://public.fixture/mcp', mimeType: 'image/png' },
        ],
      }
      const invocation = {
        state: 'result',
        toolCallId: 'call',
        toolName: 'inspect',
        args: { url: protectedUrl },
        result,
      }
      const message: any =
        format === 'db'
          ? {
              id: 'db-mcp',
              role: 'assistant',
              content: {
                format: 2,
                parts: [{ type: 'tool-invocation', toolInvocation: invocation }],
              },
            }
          : format === 'db-invocations'
            ? {
                id: 'db-invocations',
                role: 'assistant',
                content: { format: 2, parts: [], toolInvocations: [invocation] },
              }
            : format === 'v4'
              ? {
                  id: 'v4-mcp',
                  role: 'assistant',
                  content: '',
                  parts: [],
                  toolInvocations: [invocation],
                }
              : {
                  id: 'ui-mcp',
                  role: 'assistant',
                  parts: [
                    {
                      type: format === 'dynamic' ? 'dynamic-tool' : 'tool-inspect',
                      toolName: 'inspect',
                      toolCallId: 'call',
                      state: 'output-available',
                      input: { url: protectedUrl },
                      output: result,
                    },
                  ],
                }
      const [normalized]: any = await normalizeNativeMediaMessages([message], authority())
      const output =
        normalized.content?.parts?.[0]?.toolInvocation?.result ??
        normalized.content?.toolInvocations?.[0].result ??
        normalized.toolInvocations?.[0].result ??
        normalized.parts[0].output
      expect(output).toEqual({
        ...result,
        content: [
          result.content[0],
          { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
        ],
      })
      expect(result.content[1].data).toBe('https://public.fixture/mcp')
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )
  it('keeps JSON values literal and refuses only native-promoted malformed MCP Base64 before finance', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const message = (value: any): any => ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call',
          toolName: 'inspect',
          output: { type: 'json', value },
        },
      ],
    })
    const business = {
      type: 'image-url',
      url: protectedUrl,
      args: { content: [{ type: 'image', data: protectedUrl }] },
    }
    const [normalized]: any = await normalizeNativeMediaMessages([message(business)], authority())
    expect(normalized.content[0].output.value).toBe(business)
    const promoted = { content: [{ type: 'image', data: protectedUrl, mimeType: 'image/png' }] }
    await expect(
      normalizeNativeMediaMessages([message(promoted)], authority())
    ).rejects.toMatchObject({ status: 403 })
    const malformed = {
      content: [
        { type: 'image', data: 'https://public.fixture/not-base64', mimeType: 'image/png' },
      ],
    }
    await expect(
      normalizeNativeMediaMessages([message(malformed)], authority())
    ).rejects.toMatchObject({ status: 400 })
    expect(promoted.content[0].data).toBe(protectedUrl)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

it.each([null, undefined])(
  'guards MCP fallback when stored modelOutput is actually absent (%s)',
  async (modelOutput) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const message: any = {
      role: 'assistant',
      content: {
        format: 2,
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              state: 'result',
              toolCallId: 'old',
              toolName: 'inspect',
              args: {},
              result: {
                content: [
                  {
                    type: 'image',
                    data: 'https://private-source.s3.amazonaws.com/a.png',
                    mimeType: 'image/png',
                  },
                ],
              },
            },
            providerMetadata: { mastra: { modelOutput } },
          },
        ],
      },
    }
    await expect(normalizeNativeMediaMessages([message], authority())).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  }
)
