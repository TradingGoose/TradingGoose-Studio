/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processDocument } from './document-processor'
import type { KnowledgeDocumentSourceContext } from './storage'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  parse: vi.fn(),
  azure: vi.fn(),
  mistral: vi.fn(),
  guard: vi.fn(),
  transform: vi.fn(),
  chunk: vi.fn(),
}))
vi.mock('@/lib/knowledge/documents/storage', () => ({ readKnowledgeDocumentSource: mocks.read }))
vi.mock('@/lib/file-parsers', () => ({ parseBuffer: mocks.parse }))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveAzureMistralOcrServiceConfig: mocks.azure,
  resolveMistralServiceConfig: mocks.mistral,
}))
vi.mock('@/lib/uploads/source-read-boundary', () => ({ assertStorageReferenceAccess: mocks.guard }))
vi.mock('@/tools/mistral/parser', () => ({
  mistralParserTool: { transformResponse: mocks.transform },
}))
vi.mock('@/lib/chunkers', () => ({
  JsonYamlChunker: { isStructuredData: () => false },
  StructuredDataChunker: { isStructuredData: () => false },
  TextChunker: class {
    chunk = mocks.chunk
  },
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

const bytes = Buffer.from('same verified source bytes')
const originalUrl =
  'https://app.fixture/api/files/serve/s3/ws%2Fkb%2Freport.pdf?context=knowledge-base'
function source(
  overrides: Partial<KnowledgeDocumentSourceContext> = {}
): KnowledgeDocumentSourceContext {
  return {
    workspaceId: 'ws',
    knowledgeBaseId: 'kb',
    filename: 'report.pdf',
    signal: new AbortController().signal,
    reauthorize: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
const fetcher = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue(bytes)
  mocks.parse.mockResolvedValue({ content: 'parsed exact text', metadata: { type: 'text' } })
  mocks.azure.mockResolvedValue({ apiKey: null, endpoint: null, modelName: null })
  mocks.mistral.mockResolvedValue({ apiKey: null })
  mocks.chunk.mockImplementation(async (text) => [{ text, tokenCount: 1 }])
  mocks.transform.mockImplementation(async (response: Response) => {
    const value = await response.json()
    return {
      success: true,
      output: {
        content: value.pages.map((page: { markdown: string }) => page.markdown).join('\n'),
      },
    }
  })
  fetcher.mockReset().mockResolvedValue(Response.json({ pages: [{ markdown: 'OCR exact text' }] }))
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('verified KB bytes before parser/OCR contact', () => {
  it('acquires once with the actual context/signal and hands that buffer to the parser', async () => {
    const context = source()
    const result = await processDocument(originalUrl, 'report.pdf', 'application/pdf', context)
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(mocks.read.mock.calls[0].slice(0, 2)).toEqual([originalUrl, 'report.pdf'])
    expect(mocks.read.mock.calls[0][2]).toMatchObject({
      workspaceId: 'ws',
      knowledgeBaseId: 'kb',
      filename: 'report.pdf',
      reauthorize: context.reauthorize,
    })
    expect(mocks.read.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal)
    expect(mocks.parse).toHaveBeenCalledExactlyOnceWith(bytes, 'pdf')
    expect(result.metadata.processingMethod).toBe('file-parser')
    expect(result.chunks[0].text).toBe('parsed exact text')
    expect(context.reauthorize).toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses source denial before parser, OCR/config resolution or chunking', async () => {
    const denied = Object.assign(new Error('Private source denied'), { status: 403 })
    mocks.read.mockRejectedValue(denied)
    await expect(
      processDocument(originalUrl, 'report.pdf', 'application/pdf', source())
    ).rejects.toBe(denied)
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.azure).not.toHaveBeenCalled()
    expect(mocks.mistral).not.toHaveBeenCalled()
    expect(mocks.chunk).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses an empty source before any parser or OCR contact', async () => {
    mocks.read.mockResolvedValue(Buffer.alloc(0))
    await expect(
      processDocument(originalUrl, 'report.pdf', 'application/pdf', source())
    ).rejects.toThrow('source is empty')
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reauthorizes acquired bytes before configuration/parser/OCR handoff', async () => {
    const denied = Object.assign(new Error('Revoked after download'), { status: 403 })
    await expect(
      processDocument(
        originalUrl,
        'report.pdf',
        'application/pdf',
        source({ reauthorize: vi.fn().mockRejectedValue(denied) })
      )
    ).rejects.toBe(denied)
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(mocks.azure).not.toHaveBeenCalled()
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['application/pdf', 'report.pdf', 'document_url'],
    ['image/png', 'image.png', 'image_url'],
  ])(
    'delegates verified %s bytes rather than the original source URL',
    async (mimeType, filename, kind) => {
      mocks.mistral.mockResolvedValue({ apiKey: 'synthetic-ocr-key' })
      const result = await processDocument(originalUrl, filename, mimeType, source({ filename }))
      expect(mocks.read).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledOnce()
      const [endpoint, options] = fetcher.mock.calls[0]
      expect(endpoint).toBe('https://api.mistral.ai/v1/ocr')
      expect(options.redirect).toBe('error')
      expect(options.headers.Authorization).toBe('Bearer synthetic-ocr-key')
      const body = JSON.parse(options.body)
      expect(body.document).toEqual({
        type: kind,
        [kind]: `data:${mimeType};base64,${bytes.toString('base64')}`,
      })
      expect(options.body).not.toContain(originalUrl)
      expect(result.metadata.processingMethod).toBe('mistral-ocr')
      expect(mocks.parse).not.toHaveBeenCalled()
    }
  )

  it('falls back from Azure to Mistral using the same acquired bytes without copying/signing or refetching the source', async () => {
    mocks.azure.mockResolvedValue({
      apiKey: 'azure-fixture',
      endpoint: 'https://azure.fixture/ocr',
      modelName: 'configured-model',
    })
    mocks.mistral.mockResolvedValue({ apiKey: 'mistral-fixture' })
    fetcher
      .mockReset()
      .mockResolvedValueOnce(new Response('ordinary OCR failure', { status: 500 }))
      .mockResolvedValueOnce(Response.json({ pages: [{ markdown: 'fallback exact text' }] }))
    const context = source()
    const result = await processDocument(originalUrl, 'report.pdf', 'application/pdf', context)
    expect(result.chunks[0].text).toBe('fallback exact text')
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://azure.fixture/ocr',
      'https://api.mistral.ai/v1/ocr',
    ])
    for (const [, options] of fetcher.mock.calls) {
      expect(JSON.parse(options.body).document.document_url).toBe(
        `data:application/pdf;base64,${bytes.toString('base64')}`
      )
      expect(options.redirect).toBe('error')
    }
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(context.reauthorize).toHaveBeenCalled()
  })

  it('does not retry or fall back after a403 response', async () => {
    mocks.azure.mockResolvedValue({
      apiKey: 'azure-fixture',
      endpoint: 'https://azure.fixture/ocr',
      modelName: 'configured-model',
    })
    mocks.mistral.mockResolvedValue({ apiKey: 'mistral-fixture' })
    fetcher.mockResolvedValue(new Response('Forbidden', { status: 403 }))
    await expect(
      processDocument(originalUrl, 'report.pdf', 'application/pdf', source())
    ).rejects.toMatchObject({ status: 403 })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(mocks.parse).not.toHaveBeenCalled()
  })

  it('does not fall back after parent cancellation during OCR', async () => {
    mocks.mistral.mockResolvedValue({ apiKey: 'mistral-fixture' })
    const controller = new AbortController()
    fetcher.mockImplementationOnce(async (_endpoint, options) => {
      controller.abort(new Error('Document cancelled'))
      options.signal.throwIfAborted()
    })
    await expect(
      processDocument(
        originalUrl,
        'report.pdf',
        'application/pdf',
        source({ signal: controller.signal })
      )
    ).rejects.toThrow('Document cancelled')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.chunk).not.toHaveBeenCalled()
  })

  it('retains the180second acquisition limit and propagates its abort into actual source-reader signal', async () => {
    vi.useFakeTimers()
    mocks.read.mockImplementationOnce(
      (_url, _name, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          })
        })
    )
    const execution = processDocument(originalUrl, 'report.pdf', 'application/pdf', source())
    const outcome = expect(execution).rejects.toThrow('File download timed out')
    await vi.advanceTimersByTimeAsync(180000)
    await outcome
    expect(fetcher).not.toHaveBeenCalled()
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains the120second OCR limit through response-body consumption and refuses fallback after timeout', async () => {
    vi.useFakeTimers()
    mocks.mistral.mockResolvedValue({ apiKey: 'mistral-fixture' })
    fetcher.mockImplementationOnce(async (_url, options) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          })
        }),
    }))
    const execution = processDocument(originalUrl, 'report.pdf', 'application/pdf', source())
    const outcome = expect(execution).rejects.toThrow('OCR API request timed out')
    await vi.advanceTimersByTimeAsync(120000)
    await outcome
    expect(fetcher).toHaveBeenCalledOnce()
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
