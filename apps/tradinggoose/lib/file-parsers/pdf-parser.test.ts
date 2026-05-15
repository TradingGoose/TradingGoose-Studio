/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { extractTextMock, getDocumentProxyMock } = vi.hoisted(() => ({
  extractTextMock: vi.fn(),
  getDocumentProxyMock: vi.fn(),
}))

vi.mock('unpdf', () => ({
  extractText: extractTextMock,
  getDocumentProxy: getDocumentProxyMock,
}))

describe('PdfParser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDocumentProxyMock.mockResolvedValue({ numPages: 2 })
    extractTextMock.mockResolvedValue({
      totalPages: 2,
      text: 'hello\u0000 world',
    })
  })

  it('loads the parser without loading a package entrypoint at module import time', async () => {
    const { PdfParser } = await import('@/lib/file-parsers/pdf-parser')

    expect(new PdfParser()).toBeInstanceOf(PdfParser)
    expect(getDocumentProxyMock).not.toHaveBeenCalled()
  })

  it('parses PDF buffers with unpdf', async () => {
    const { PdfParser } = await import('@/lib/file-parsers/pdf-parser')

    const result = await new PdfParser().parseBuffer(Buffer.from('%PDF test'))

    expect(getDocumentProxyMock).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect(extractTextMock).toHaveBeenCalledWith({ numPages: 2 }, { mergePages: true })
    expect(result).toEqual({
      content: 'hello world',
      metadata: {
        pageCount: 2,
        source: 'unpdf',
      },
    })
  })
})
