export interface FileParseResult {
  content: string
  metadata?: Record<string, any>
}

export interface FileParser {
  parseFile(filePath: string): Promise<FileParseResult>
  parseBuffer?(buffer: Buffer): Promise<FileParseResult>
}

export const SUPPORTED_FILE_TYPES = [
  'pdf',
  'csv',
  'docx',
  'doc',
  'txt',
  'md',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
  'html',
  'htm',
  'json',
  'yaml',
  'yml',
] as const

export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number]
