import { existsSync } from 'fs'
import path from 'path'
import { CsvParser } from '@/lib/file-parsers/csv-parser'
import { DocParser } from '@/lib/file-parsers/doc-parser'
import { DocxParser } from '@/lib/file-parsers/docx-parser'
import { HtmlParser } from '@/lib/file-parsers/html-parser'
import { parseJSON, parseJSONBuffer } from '@/lib/file-parsers/json-parser'
import { MdParser } from '@/lib/file-parsers/md-parser'
import { PdfParser } from '@/lib/file-parsers/pdf-parser'
import { PptxParser } from '@/lib/file-parsers/pptx-parser'
import { TxtParser } from '@/lib/file-parsers/txt-parser'
import type { FileParseResult, FileParser, SupportedFileType } from '@/lib/file-parsers/types'
import { SUPPORTED_FILE_TYPES } from '@/lib/file-parsers/types'
import { XlsxParser } from '@/lib/file-parsers/xlsx-parser'
import { parseYAML, parseYAMLBuffer } from '@/lib/file-parsers/yaml-parser'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('FileParser')

const xlsxParser = new XlsxParser()
const pptxParser = new PptxParser()
const htmlParser = new HtmlParser()

const parserInstances = {
  pdf: new PdfParser(),
  csv: new CsvParser(),
  docx: new DocxParser(),
  doc: new DocParser(),
  txt: new TxtParser(),
  md: new MdParser(),
  xlsx: xlsxParser,
  xls: xlsxParser,
  pptx: pptxParser,
  ppt: pptxParser,
  html: htmlParser,
  htm: htmlParser,
  json: {
    parseFile: parseJSON,
    parseBuffer: parseJSONBuffer,
  },
  yaml: {
    parseFile: parseYAML,
    parseBuffer: parseYAMLBuffer,
  },
  yml: {
    parseFile: parseYAML,
    parseBuffer: parseYAMLBuffer,
  },
} satisfies Record<SupportedFileType, FileParser>

const normalizeExtension = (extension: string) => extension.toLowerCase().replace(/^\./, '')

const supportedTypesMessage = () => SUPPORTED_FILE_TYPES.join(', ')

function getParser(extension: string): FileParser {
  const normalizedExtension = normalizeExtension(extension)

  if (!isSupportedFileType(normalizedExtension)) {
    throw new Error(
      `Unsupported file type: ${normalizedExtension}. Supported types are: ${supportedTypesMessage()}`
    )
  }

  return parserInstances[normalizedExtension]
}

/**
 * Parse a file based on its extension
 * @param filePath Path to the file
 * @returns Parsed content and metadata
 */
export async function parseFile(filePath: string): Promise<FileParseResult> {
  try {
    if (!filePath) {
      throw new Error('No file path provided')
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const extension = path.extname(filePath).substring(1)
    logger.info('Attempting to parse file with extension:', extension)

    const parser = getParser(extension)
    logger.info('Using parser for extension:', normalizeExtension(extension))

    return await parser.parseFile(filePath)
  } catch (error) {
    logger.error('File parsing error:', error)
    throw error
  }
}

/**
 * Parse a buffer based on file extension
 * @param buffer Buffer containing the file data
 * @param extension File extension without the dot (e.g., 'pdf', 'csv')
 * @returns Parsed content and metadata
 */
export async function parseBuffer(buffer: Buffer, extension: string): Promise<FileParseResult> {
  try {
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty buffer provided')
    }

    if (!extension) {
      throw new Error('No file extension provided')
    }

    logger.info('Attempting to parse buffer with extension:', extension)

    const parser = getParser(extension)
    const normalizedExtension = normalizeExtension(extension)
    logger.info('Using parser for extension:', normalizedExtension)

    if (!parser.parseBuffer) {
      throw new Error(`Parser for ${normalizedExtension} does not support buffer parsing`)
    }

    return await parser.parseBuffer(buffer)
  } catch (error) {
    logger.error('Buffer parsing error:', error)
    throw error
  }
}

/**
 * Check if a file type is supported
 * @param extension File extension without the dot
 * @returns true if supported, false otherwise
 */
export function isSupportedFileType(extension: string): extension is SupportedFileType {
  if (!extension) return false
  return (SUPPORTED_FILE_TYPES as readonly string[]).includes(normalizeExtension(extension))
}

export type { FileParseResult, FileParser, SupportedFileType }
