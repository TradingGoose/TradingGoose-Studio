import { type Chunk, JsonYamlChunker, StructuredDataChunker, TextChunker } from '@/lib/chunkers'
import { parseBuffer } from '@/lib/file-parsers'
import {
  type KnowledgeDocumentSourceContext,
  readKnowledgeDocumentSource,
} from '@/lib/knowledge/documents/storage'
import { isRetryableError, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import { createLogger } from '@/lib/logs/console/logger'
import {
  resolveAzureMistralOcrServiceConfig,
  resolveMistralServiceConfig,
} from '@/lib/system-services/runtime'
import { assertStorageReferenceAccess } from '@/lib/uploads/source-read-boundary'
import { mistralParserTool } from '@/tools/mistral/parser'

const logger = createLogger('DocumentProcessor')
const TIMEOUTS = { FILE_DOWNLOAD: 180000, MISTRAL_OCR_API: 120000 } as const

type OCRResult = { success: boolean; error?: string; output?: { content?: string } }
type OCRPage = { markdown?: string }
type OCRRequestBody = {
  model: string
  document:
    | { type: 'document_url'; document_url: string }
    | { type: 'image_url'; image_url: string }
  include_image_base64: boolean
}
class APIError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
    this.name = 'APIError'
  }
}

async function authorizeSource(source: KnowledgeDocumentSourceContext) {
  source.signal.throwIfAborted()
  await source.reauthorize()
  source.signal.throwIfAborted()
}
function refuseFallback(error: unknown, source: KnowledgeDocumentSourceContext) {
  source.signal.throwIfAborted()
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw error
  if (error && typeof error === 'object' && 'status' in error && error.status === 403) throw error
}
function ocrBody(buffer: Buffer, mimeType: string, model: string): OCRRequestBody {
  const data = `data:${mimeType};base64,${buffer.toString('base64')}`
  return {
    model,
    document: mimeType.startsWith('image/')
      ? { type: 'image_url', image_url: data }
      : { type: 'document_url', document_url: data },
    include_image_base64: false,
  }
}

export async function processDocument(
  fileUrl: string,
  filename: string,
  mimeType: string,
  source: KnowledgeDocumentSourceContext,
  chunkSize = 1000,
  chunkOverlap = 200,
  minChunkSize = 1
): Promise<{
  chunks: Chunk[]
  metadata: {
    filename: string
    fileSize: number
    mimeType: string
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingMethod: 'file-parser' | 'mistral-ocr'
    cloudUrl?: string
  }
}> {
  logger.info(`Processing document: ${filename}`)

  try {
    const downloadController = new AbortController()
    const timeoutId = setTimeout(
      () => downloadController.abort(new Error('File download timed out')),
      TIMEOUTS.FILE_DOWNLOAD
    )
    let buffer: Buffer
    try {
      buffer = await readKnowledgeDocumentSource(fileUrl, filename, {
        ...source,
        signal: AbortSignal.any([source.signal, downloadController.signal]),
      })
    } finally {
      clearTimeout(timeoutId)
    }
    if (!buffer.length) throw new Error('Document source is empty')
    const parseResult = await parseDocument(buffer, filename, mimeType, source)
    const { content, processingMethod } = parseResult
    const cloudUrl = 'cloudUrl' in parseResult ? parseResult.cloudUrl : undefined

    let chunks: Chunk[]
    const metadata = parseResult.metadata ?? {}

    const isJsonYaml =
      metadata.type === 'json' ||
      metadata.type === 'yaml' ||
      mimeType.includes('json') ||
      mimeType.includes('yaml')

    if (isJsonYaml && JsonYamlChunker.isStructuredData(content)) {
      logger.info('Using JSON/YAML chunker for structured data')
      chunks = await JsonYamlChunker.chunkJsonYaml(content, {
        chunkSize,
        minChunkSize,
      })
    } else if (StructuredDataChunker.isStructuredData(content, mimeType)) {
      logger.info('Using structured data chunker for spreadsheet/CSV content')
      chunks = await StructuredDataChunker.chunkStructuredData(content, {
        headers: metadata.headers,
        totalRows: metadata.totalRows || metadata.rowCount,
        sheetName: metadata.sheetNames?.[0],
      })
    } else {
      const chunker = new TextChunker({ chunkSize, overlap: chunkOverlap, minChunkSize })
      chunks = await chunker.chunk(content)
    }

    await authorizeSource(source)
    const characterCount = content.length
    const tokenCount = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)

    logger.info(`Document processed: ${chunks.length} chunks, ${tokenCount} tokens`)

    return {
      chunks,
      metadata: {
        filename,
        fileSize: characterCount,
        mimeType,
        chunkCount: chunks.length,
        tokenCount,
        characterCount,
        processingMethod,
        cloudUrl,
      },
    }
  } catch (error) {
    logger.error(`Error processing document ${filename}:`, error)
    throw error
  }
}

async function parseDocument(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  source: KnowledgeDocumentSourceContext
): Promise<{
  content: string
  processingMethod: 'file-parser' | 'mistral-ocr'
  cloudUrl?: string
  metadata?: Record<string, any>
}> {
  await authorizeSource(source)
  const [azure, mistral] = await Promise.all([
    resolveAzureMistralOcrServiceConfig(),
    resolveMistralServiceConfig(),
  ])
  await authorizeSource(source)
  if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
    if (azure.apiKey && azure.endpoint && azure.modelName) {
      try {
        const result = await requestOCR(
          azure.endpoint,
          azure.apiKey,
          ocrBody(buffer, mimeType, azure.modelName),
          source,
          async (response) => (await response.json()) as { pages?: OCRPage[] }
        )
        const content =
          result.pages
            ?.map((page) => page.markdown || '')
            .filter(Boolean)
            .join('\n\n') || JSON.stringify(result, null, 2)
        if (!content.trim()) throw new Error('Azure Mistral OCR returned empty content')
        return { content, processingMethod: 'mistral-ocr' }
      } catch (error) {
        refuseFallback(error, source)
        await authorizeSource(source)
        logger.warn(`Azure Mistral OCR failed for ${filename}; trying the configured fallback`)
      }
    }
    if (mistral.apiKey) {
      try {
        const result = await requestOCR(
          'https://api.mistral.ai/v1/ocr',
          mistral.apiKey,
          ocrBody(buffer, mimeType, 'mistral-ocr-latest'),
          source,
          async (response) =>
            (await mistralParserTool.transformResponse!(response, {
              filePath: `data:${mimeType};base64,${buffer.toString('base64')}`,
              apiKey: mistral.apiKey!,
              resultType: 'text',
            })) as OCRResult
        )
        if (!result.success)
          throw new Error(`OCR processing failed: ${result.error || 'Unknown error'}`)
        const content = result.output?.content || ''
        if (!content.trim()) throw new Error('OCR returned empty content')
        return { content, processingMethod: 'mistral-ocr' }
      } catch (error) {
        refuseFallback(error, source)
        await authorizeSource(source)
        logger.warn(`Mistral OCR failed for ${filename}; using the file parser`)
      }
    }
  }
  await authorizeSource(source)
  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension) throw new Error(`Could not determine file extension: ${filename}`)
  const parsed = await parseBuffer(buffer, extension)
  await authorizeSource(source)
  if (!parsed.content.trim()) throw new Error('File parser returned empty content')
  return {
    content: parsed.content,
    metadata: parsed.metadata,
    processingMethod: 'file-parser',
  }
}

/** The timeout covers both the HTTP request and complete response-body consumption. */
async function requestOCR<T>(
  endpoint: string,
  apiKey: string,
  body: OCRRequestBody,
  source: KnowledgeDocumentSourceContext,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  assertStorageReferenceAccess(endpoint)
  return retryWithExponentialBackoff(
    async () => {
      await authorizeSource(source)
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(new DOMException('OCR API request timed out', 'TimeoutError')),
        TIMEOUTS.MISTRAL_OCR_API
      )
      const signal = AbortSignal.any([source.signal, controller.signal])
      try {
        signal.throwIfAborted()
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
          redirect: 'error',
        })
        if (!response.ok) {
          const detail = await response.text()
          throw new APIError(
            `OCR failed: ${response.status} ${response.statusText} - ${detail}`,
            response.status
          )
        }
        const result = await consume(response)
        signal.throwIfAborted()
        await authorizeSource(source)
        signal.throwIfAborted()
        return result
      } finally {
        clearTimeout(timer)
      }
    },
    {
      signal: source.signal,
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryCondition: (error) => {
        refuseFallback(error, source)
        return isRetryableError(error)
      },
    }
  )
}
