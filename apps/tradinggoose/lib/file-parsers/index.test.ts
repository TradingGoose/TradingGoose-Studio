/**
 * Unit tests for file parsers
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.fn().mockReturnValue(true)
const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('test content'))

const mockPdfParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed PDF content',
  metadata: {
    info: { Title: 'Test PDF' },
    pageCount: 5,
    version: '1.7',
  },
})
const mockPdfParseBuffer = vi.fn().mockResolvedValue({
  content: 'Parsed PDF buffer content',
  metadata: {
    pageCount: 5,
    source: 'unpdf',
  },
})

const mockCsvParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed CSV content',
  metadata: {
    headers: ['column1', 'column2'],
    rowCount: 10,
  },
})
const mockCsvParseBuffer = vi.fn().mockResolvedValue({
  content: 'Parsed CSV buffer content',
  metadata: {
    headers: ['column1', 'column2'],
    rowCount: 10,
  },
})

const mockDocxParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed DOCX content',
  metadata: {
    pages: 3,
    author: 'Test Author',
  },
})
const mockDocParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed DOC content',
  metadata: {
    pages: 3,
    author: 'Test Author',
  },
})

const mockTxtParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed TXT content',
  metadata: {
    characterCount: 100,
    tokenCount: 10,
  },
})

const mockMdParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed MD content',
  metadata: {
    characterCount: 100,
    tokenCount: 10,
  },
})

const mockPptxParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed PPTX content',
  metadata: {
    slideCount: 5,
    extractionMethod: 'officeparser',
  },
})

const mockHtmlParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed HTML content',
  metadata: {
    title: 'Test HTML Document',
    headingCount: 3,
    linkCount: 2,
  },
})

const mockXlsxParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed XLSX content',
  metadata: {
    sheetNames: ['Sheet1'],
  },
})
const mockJsonParseFile = vi.fn().mockResolvedValue({
  content: '{"ok": true}',
  metadata: {
    type: 'json',
  },
})
const mockJsonParseBuffer = vi.fn().mockResolvedValue({
  content: '{"ok": true}',
  metadata: {
    type: 'json',
  },
})
const mockYamlParseFile = vi.fn().mockResolvedValue({
  content: 'ok: true',
  metadata: {
    type: 'yaml',
  },
})
const mockYamlParseBuffer = vi.fn().mockResolvedValue({
  content: 'ok: true',
  metadata: {
    type: 'yaml',
  },
})

describe('File Parsers', () => {
  beforeEach(() => {
    vi.resetModules()

    vi.doMock('fs', () => ({
      existsSync: mockExistsSync,
    }))

    vi.doMock('fs/promises', () => ({
      readFile: mockReadFile,
    }))

    vi.doMock('@/lib/file-parsers/pdf-parser', () => ({
      PdfParser: vi.fn().mockImplementation(() => ({
        parseFile: mockPdfParseFile,
        parseBuffer: mockPdfParseBuffer,
      })),
    }))

    vi.doMock('@/lib/file-parsers/csv-parser', () => ({
      CsvParser: vi.fn().mockImplementation(() => ({
        parseFile: mockCsvParseFile,
        parseBuffer: mockCsvParseBuffer,
      })),
    }))

    vi.doMock('@/lib/file-parsers/docx-parser', () => ({
      DocxParser: vi.fn().mockImplementation(() => ({
        parseFile: mockDocxParseFile,
      })),
    }))

    vi.doMock('@/lib/file-parsers/doc-parser', () => ({
      DocParser: vi.fn().mockImplementation(() => ({
        parseFile: mockDocParseFile,
      })),
    }))

    vi.doMock('@/lib/file-parsers/txt-parser', () => ({
      TxtParser: vi.fn().mockImplementation(() => ({
        parseFile: mockTxtParseFile,
      })),
    }))

    vi.doMock('@/lib/file-parsers/md-parser', () => ({
      MdParser: vi.fn().mockImplementation(() => ({
        parseFile: mockMdParseFile,
      })),
    }))

    vi.doMock('@/lib/file-parsers/pptx-parser', () => ({
      PptxParser: vi.fn().mockImplementation(() => ({
        parseFile: mockPptxParseFile,
      })),
    }))

    vi.doMock('@/lib/file-parsers/html-parser', () => ({
      HtmlParser: vi.fn().mockImplementation(() => ({
        parseFile: mockHtmlParseFile,
      })),
    }))

    vi.doMock('@/lib/file-parsers/xlsx-parser', () => ({
      XlsxParser: vi.fn().mockImplementation(() => ({
        parseFile: mockXlsxParseFile,
      })),
    }))

    vi.doMock('@/lib/file-parsers/json-parser', () => ({
      parseJSON: mockJsonParseFile,
      parseJSONBuffer: mockJsonParseBuffer,
    }))

    vi.doMock('@/lib/file-parsers/yaml-parser', () => ({
      parseYAML: mockYamlParseFile,
      parseYAMLBuffer: mockYamlParseBuffer,
    }))

    global.console = {
      ...console,
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
    vi.restoreAllMocks()
  })

  describe('parseFile', () => {
    it('should validate file existence', async () => {
      mockExistsSync.mockReturnValueOnce(false)

      const { parseFile } = await import('@/lib/file-parsers/index')

      const testFilePath = '/test/files/test.pdf'
      await expect(parseFile(testFilePath)).rejects.toThrow('File not found')
      expect(mockExistsSync).toHaveBeenCalledWith(testFilePath)
    })

    it('should throw error if file path is empty', async () => {
      const { parseFile } = await import('@/lib/file-parsers/index')
      await expect(parseFile('')).rejects.toThrow('No file path provided')
    })

    it('should parse PDF files successfully', async () => {
      const expectedResult = {
        content: 'Parsed PDF content',
        metadata: {
          info: { Title: 'Test PDF' },
          pageCount: 5,
          version: '1.7',
        },
      }

      mockPdfParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/document.pdf')

      expect(result).toEqual(expectedResult)
    })

    it('should parse CSV files successfully', async () => {
      const expectedResult = {
        content: 'Parsed CSV content',
        metadata: {
          headers: ['column1', 'column2'],
          rowCount: 10,
        },
      }

      mockCsvParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/data.csv')

      expect(result).toEqual(expectedResult)
    })

    it('should parse DOCX files successfully', async () => {
      const expectedResult = {
        content: 'Parsed DOCX content',
        metadata: {
          pages: 3,
          author: 'Test Author',
        },
      }

      mockDocxParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/document.docx')

      expect(result).toEqual(expectedResult)
    })

    it('should parse TXT files successfully', async () => {
      const expectedResult = {
        content: 'Parsed TXT content',
        metadata: {
          characterCount: 100,
          tokenCount: 10,
        },
      }

      mockTxtParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/document.txt')

      expect(result).toEqual(expectedResult)
    })

    it('should parse MD files successfully', async () => {
      const expectedResult = {
        content: 'Parsed MD content',
        metadata: {
          characterCount: 100,
          tokenCount: 10,
        },
      }

      mockMdParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/document.md')

      expect(result).toEqual(expectedResult)
    })

    it('should parse PPTX files successfully', async () => {
      const expectedResult = {
        content: 'Parsed PPTX content',
        metadata: {
          slideCount: 5,
          extractionMethod: 'officeparser',
        },
      }

      mockPptxParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/presentation.pptx')

      expect(result).toEqual(expectedResult)
    })

    it('should parse PPT files successfully', async () => {
      const expectedResult = {
        content: 'Parsed PPTX content',
        metadata: {
          slideCount: 5,
          extractionMethod: 'officeparser',
        },
      }

      mockPptxParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/presentation.ppt')

      expect(result).toEqual(expectedResult)
    })

    it('should parse HTML files successfully', async () => {
      const expectedResult = {
        content: 'Parsed HTML content',
        metadata: {
          title: 'Test HTML Document',
          headingCount: 3,
          linkCount: 2,
        },
      }

      mockHtmlParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/document.html')

      expect(result).toEqual(expectedResult)
    })

    it('should parse HTM files successfully', async () => {
      const expectedResult = {
        content: 'Parsed HTML content',
        metadata: {
          title: 'Test HTML Document',
          headingCount: 3,
          linkCount: 2,
        },
      }

      mockHtmlParseFile.mockResolvedValueOnce(expectedResult)
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const result = await parseFile('/test/files/document.htm')

      expect(result).toEqual(expectedResult)
    })

    it('should parse PDF buffers successfully', async () => {
      const expectedResult = {
        content: 'Parsed PDF buffer content',
        metadata: {
          pageCount: 5,
          source: 'unpdf',
        },
      }

      mockPdfParseBuffer.mockResolvedValueOnce(expectedResult)

      const { parseBuffer } = await import('@/lib/file-parsers/index')
      const result = await parseBuffer(Buffer.from('%PDF-1.7'), 'pdf')

      expect(result).toEqual(expectedResult)
      expect(mockPdfParseBuffer).toHaveBeenCalledWith(Buffer.from('%PDF-1.7'))
    })

    it('should throw error for unsupported file types', async () => {
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('@/lib/file-parsers/index')
      const unsupportedFilePath = '/test/files/image.png'

      await expect(parseFile(unsupportedFilePath)).rejects.toThrow('Unsupported file type')
    })

    it('should handle errors during parsing', async () => {
      mockExistsSync.mockReturnValue(true)

      const parsingError = new Error('CSV parsing failed')
      mockCsvParseFile.mockRejectedValueOnce(parsingError)

      const { parseFile } = await import('@/lib/file-parsers/index')
      await expect(parseFile('/test/files/data.csv')).rejects.toThrow('CSV parsing failed')
    })
  })

  describe('isSupportedFileType', () => {
    it('should return true for supported file types', async () => {
      const { isSupportedFileType } = await import('@/lib/file-parsers/index')

      expect(isSupportedFileType('pdf')).toBe(true)
      expect(isSupportedFileType('csv')).toBe(true)
      expect(isSupportedFileType('doc')).toBe(true)
      expect(isSupportedFileType('docx')).toBe(true)
      expect(isSupportedFileType('txt')).toBe(true)
      expect(isSupportedFileType('md')).toBe(true)
      expect(isSupportedFileType('xlsx')).toBe(true)
      expect(isSupportedFileType('xls')).toBe(true)
      expect(isSupportedFileType('pptx')).toBe(true)
      expect(isSupportedFileType('ppt')).toBe(true)
      expect(isSupportedFileType('html')).toBe(true)
      expect(isSupportedFileType('htm')).toBe(true)
      expect(isSupportedFileType('json')).toBe(true)
      expect(isSupportedFileType('yaml')).toBe(true)
      expect(isSupportedFileType('yml')).toBe(true)
    })

    it('should return false for unsupported file types', async () => {
      const { isSupportedFileType } = await import('@/lib/file-parsers/index')

      expect(isSupportedFileType('png')).toBe(false)
      expect(isSupportedFileType('unknown')).toBe(false)
    })

    it('should handle uppercase extensions', async () => {
      const { isSupportedFileType } = await import('@/lib/file-parsers/index')

      expect(isSupportedFileType('PDF')).toBe(true)
      expect(isSupportedFileType('CSV')).toBe(true)
      expect(isSupportedFileType('TXT')).toBe(true)
      expect(isSupportedFileType('MD')).toBe(true)
      expect(isSupportedFileType('PPTX')).toBe(true)
      expect(isSupportedFileType('HTML')).toBe(true)
      expect(isSupportedFileType('JSON')).toBe(true)
    })
  })
})
