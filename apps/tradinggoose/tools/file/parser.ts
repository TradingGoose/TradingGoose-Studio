import type {
  FileParseApiMultiResponse,
  FileParseApiResponse,
  FileParserInput,
  FileParserOutput,
} from '@/tools/file/types'
import type { ToolConfig } from '@/tools/types'

interface ToolBodyParams extends FileParserInput {
  _context?: {
    workspaceId?: string
    workflowId?: string
    executionId?: string
  }
}

export const fileParserTool: ToolConfig<FileParserInput, FileParserOutput> = {
  id: 'file_parser',
  name: 'File Parser',
  description: 'Parse one or more uploaded files or files from URLs (text, PDF, CSV, images, etc.)',
  version: '1.0.0',

  params: {
    filePath: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Path to the file(s). Can be a single path, URL, or an array of paths.',
    },
    fileType: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Type of file to parse (auto-detected if not specified)',
    },
  },

  request: {
    url: '/api/files/parse',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: ToolBodyParams) => ({
      filePath: params.filePath,
      fileType: params.fileType,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },

  transformResponse: async (response: Response): Promise<FileParserOutput> => {
    const result = (await response.json()) as FileParseApiResponse | FileParseApiMultiResponse
    if (!response.ok || !result.success) {
      throw new Error(
        'error' in result && typeof result.error === 'string'
          ? result.error
          : 'File access or parsing is unavailable'
      )
    }
    const files = ('results' in result ? result.results : [result]).map((file) => {
      if (!file.success) throw new Error(file.error || 'A requested file could not be parsed')
      return file.output
    })
    return {
      success: true,
      output: {
        files,
        combinedContent: files.map((file) => file.content).join(`\n${'='.repeat(80)}\n\n`),
      },
    }
  },

  outputs: {
    files: { type: 'array', description: 'Array of parsed files with content and metadata' },
    combinedContent: { type: 'string', description: 'Combined content of all parsed files' },
  },
}
