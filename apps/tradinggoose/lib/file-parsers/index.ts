import { existsSync } from 'fs'
import path from 'path'
import type { FileParseResult, FileParser, SupportedFileType } from '@/lib/file-parsers/types'
import { SUPPORTED_FILE_TYPES } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('FileParser')

const normalizeExtension = (extension: string) => extension.toLowerCase().replace(/^\./, '')

const supportedTypesMessage = () => SUPPORTED_FILE_TYPES.join(', ')

async function getParser(extension: string): Promise<FileParser> {
  const normalizedExtension = normalizeExtension(extension)

  if (!isSupportedFileType(normalizedExtension)) {
    throw new Error(
      `Unsupported file type: ${normalizedExtension}. Supported types are: ${supportedTypesMessage()}`
    )
  }

  switch (normalizedExtension) {
    case 'pdf':
      return new (await import('./pdf-parser')).PdfParser()
    case 'csv':
      return new (await import('./csv-parser')).CsvParser()
    case 'docx':
      return new (await import('./docx-parser')).DocxParser()
    case 'doc':
      return new (await import('./doc-parser')).DocParser()
    case 'txt':
      return new (await import('./txt-parser')).TxtParser()
    case 'md':
      return new (await import('./md-parser')).MdParser()
    case 'xlsx':
    case 'xls':
      return new (await import('./xlsx-parser')).XlsxParser()
    case 'pptx':
    case 'ppt':
      return new (await import('./pptx-parser')).PptxParser()
    case 'html':
    case 'htm':
      return new (await import('./html-parser')).HtmlParser()
    case 'json': {
      const { parseJSON, parseJSONBuffer } = await import('./json-parser')
      return { parseFile: parseJSON, parseBuffer: parseJSONBuffer }
    }
    case 'yaml':
    case 'yml': {
      const { parseYAML, parseYAMLBuffer } = await import('./yaml-parser')
      return { parseFile: parseYAML, parseBuffer: parseYAMLBuffer }
    }
  }
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

    const parser = await getParser(extension)
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

    const parser = await getParser(extension)
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
