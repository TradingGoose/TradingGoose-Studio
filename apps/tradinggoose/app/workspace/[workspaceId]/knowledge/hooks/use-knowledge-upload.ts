import { useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('KnowledgeUpload')

export interface UploadedFile {
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  tag1?: string
  tag2?: string
  tag3?: string
  tag4?: string
  tag5?: string
  tag6?: string
  tag7?: string
}

export interface FileUploadStatus {
  fileName: string
  fileSize: number
  status: 'pending' | 'uploading' | 'completed' | 'failed'
  progress?: number
  error?: string
}

export interface UploadProgress {
  stage: 'idle' | 'uploading' | 'processing' | 'completing'
  filesCompleted: number
  totalFiles: number
  currentFile?: string
  currentFileProgress?: number
  fileStatuses?: FileUploadStatus[]
}

export interface UploadError {
  message: string
  timestamp: number
  code?: string
  details?: any
}

export interface ProcessingOptions {
  chunkSize: number
  minCharactersPerChunk: number
  chunkOverlap: number
}

export interface UseKnowledgeUploadOptions {
  onUploadComplete?: (uploadedFiles: UploadedFile[]) => void
  onError?: (error: UploadError) => void
  workspaceId: string
}

class KnowledgeUploadError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'KnowledgeUploadError'
  }
}

class UploadApiError extends KnowledgeUploadError {
  constructor(
    message: string,
    public status?: number,
    details?: any
  ) {
    super(message, 'UPLOAD_API_ERROR', details)
    this.name = 'UploadApiError'
  }
}

class ProcessingError extends KnowledgeUploadError {
  constructor(message: string, details?: any) {
    super(message, 'PROCESSING_ERROR', details)
  }
}

const UPLOAD_CONFIG = {
  MAX_PARALLEL_UPLOADS: 3,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 2000,
  RETRY_BACKOFF: 2,
  BASE_TIMEOUT_MS: 2 * 60 * 1000,
  TIMEOUT_PER_MB_MS: 1500,
  MAX_TIMEOUT_MS: 10 * 60 * 1000,
} as const

const calculateUploadTimeoutMs = (fileSize: number) => {
  const sizeInMb = fileSize / (1024 * 1024)
  const dynamicBudget = UPLOAD_CONFIG.BASE_TIMEOUT_MS + sizeInMb * UPLOAD_CONFIG.TIMEOUT_PER_MB_MS
  return Math.min(dynamicBudget, UPLOAD_CONFIG.MAX_TIMEOUT_MS)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getHighResTime = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

const formatMegabytes = (bytes: number) => Number((bytes / (1024 * 1024)).toFixed(2))

const formatDurationSeconds = (durationMs: number) => Number((durationMs / 1000).toFixed(2))

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> => {
  const results: Array<PromiseSettledResult<R>> = Array(items.length)
  const concurrency = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0

  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const currentIndex = nextIndex++
      if (currentIndex >= items.length) break

      try {
        results[currentIndex] = {
          status: 'fulfilled',
          value: await worker(items[currentIndex], currentIndex),
        }
      } catch (error) {
        results[currentIndex] = { status: 'rejected', reason: error }
      }
    }
  })

  await Promise.all(runners)
  return results
}

const getErrorName = (error: unknown) =>
  typeof error === 'object' && error !== null && 'name' in error ? String((error as any).name) : ''

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'

const isAbortError = (error: unknown) => getErrorName(error) === 'AbortError'

const isNetworkError = (error: unknown) => {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('ecconnreset')
  )
}

const isRetryableUploadError = (error: unknown) => {
  if (isAbortError(error) || isNetworkError(error)) return true
  return (
    error instanceof UploadApiError &&
    (!error.status || error.status === 429 || error.status >= 500)
  )
}

export function useKnowledgeUpload(options: UseKnowledgeUploadOptions) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: 'idle',
    filesCompleted: 0,
    totalFiles: 0,
  })
  const [uploadError, setUploadError] = useState<UploadError | null>(null)

  const createUploadedFile = (
    filename: string,
    fileUrl: string,
    fileSize: number,
    mimeType: string,
    originalFile?: File
  ): UploadedFile => ({
    filename,
    fileUrl,
    fileSize,
    mimeType,
    tag1: (originalFile as any)?.tag1,
    tag2: (originalFile as any)?.tag2,
    tag3: (originalFile as any)?.tag3,
    tag4: (originalFile as any)?.tag4,
    tag5: (originalFile as any)?.tag5,
    tag6: (originalFile as any)?.tag6,
    tag7: (originalFile as any)?.tag7,
  })

  const createErrorFromException = (error: unknown, defaultMessage: string): UploadError => {
    if (error instanceof KnowledgeUploadError) {
      return {
        message: error.message,
        code: error.code,
        details: error.details,
        timestamp: Date.now(),
      }
    }

    if (error instanceof Error) {
      return {
        message: error.message,
        timestamp: Date.now(),
      }
    }

    return {
      message: defaultMessage,
      timestamp: Date.now(),
    }
  }

  const uploadFileThroughAPI = async (
    file: File,
    knowledgeBaseId: string,
    timeoutMs: number,
    fileIndex?: number
  ): Promise<UploadedFile> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const startTime = getHighResTime()

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('workspaceId', options.workspaceId)
      formData.append('knowledgeBaseId', knowledgeBaseId)

      const uploadResponse = await fetch('/api/files/upload?type=knowledge-base', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!uploadResponse.ok) {
        let errorData: any = null
        try {
          errorData = await uploadResponse.json()
        } catch {
          // Response was not JSON.
        }

        throw new UploadApiError(
          `Failed to upload ${file.name}: ${errorData?.error || errorData?.message || 'Unknown error'}`,
          uploadResponse.status,
          errorData
        )
      }

      const uploadResult = await uploadResponse.json()
      const fileUrl = uploadResult.path || uploadResult.url

      if (!fileUrl) {
        throw new UploadApiError(
          `Invalid upload response for ${file.name}: missing file path`,
          undefined,
          uploadResult
        )
      }

      const durationMs = getHighResTime() - startTime
      logger.info('Knowledge file upload completed', {
        fileName: file.name,
        sizeMB: formatMegabytes(file.size),
        durationMs: formatDurationSeconds(durationMs),
      })

      if (fileIndex !== undefined) {
        setUploadProgress((prev) => ({
          ...prev,
          currentFileProgress: 100,
          fileStatuses: prev.fileStatuses?.map((fs, idx) =>
            idx === fileIndex ? { ...fs, progress: 100 } : fs
          ),
        }))
      }

      return createUploadedFile(
        file.name,
        fileUrl.startsWith('http') ? fileUrl : `${window.location.origin}${fileUrl}`,
        file.size,
        file.type,
        file
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  const uploadSingleFileWithRetry = async (
    file: File,
    knowledgeBaseId: string,
    retryCount = 0,
    fileIndex?: number
  ): Promise<UploadedFile> => {
    const timeoutMs = calculateUploadTimeoutMs(file.size)
    const attempt = retryCount + 1

    logger.info('Upload attempt started', {
      fileName: file.name,
      attempt,
      sizeMB: formatMegabytes(file.size),
      timeoutMs: formatDurationSeconds(timeoutMs),
    })

    try {
      return await uploadFileThroughAPI(file, knowledgeBaseId, timeoutMs, fileIndex)
    } catch (error) {
      if (retryCount < UPLOAD_CONFIG.MAX_RETRIES && isRetryableUploadError(error)) {
        const delay = UPLOAD_CONFIG.RETRY_DELAY_MS * UPLOAD_CONFIG.RETRY_BACKOFF ** retryCount

        logger.warn(`Upload failed, retrying in ${delay / 1000}s...`, {
          fileName: file.name,
          attempt,
          nextAttempt: attempt + 1,
          error: getErrorMessage(error),
        })

        if (fileIndex !== undefined) {
          setUploadProgress((prev) => ({
            ...prev,
            currentFile: file.name,
            currentFileProgress: 0,
            fileStatuses: prev.fileStatuses?.map((fs, idx) =>
              idx === fileIndex ? { ...fs, progress: 0, status: 'uploading' as const } : fs
            ),
          }))
        }

        await sleep(delay)
        return uploadSingleFileWithRetry(file, knowledgeBaseId, retryCount + 1, fileIndex)
      }

      logger.error('Upload failed', {
        fileName: file.name,
        attempts: retryCount + 1,
        error: getErrorMessage(error),
      })
      throw error
    }
  }

  const uploadFilesWithConcurrency = async (
    files: File[],
    knowledgeBaseId: string
  ): Promise<UploadedFile[]> => {
    const results: UploadedFile[] = []
    const failedFiles: Array<{ file: File; error: Error }> = []

    const fileStatuses: FileUploadStatus[] = files.map((file) => ({
      fileName: file.name,
      fileSize: file.size,
      status: 'pending',
      progress: 0,
    }))

    setUploadProgress((prev) => ({
      ...prev,
      fileStatuses,
    }))

    const uploadResults = await runWithConcurrency(
      files,
      UPLOAD_CONFIG.MAX_PARALLEL_UPLOADS,
      async (file, fileIndex) => {
        setUploadProgress((prev) => ({
          ...prev,
          currentFile: file.name,
          currentFileProgress: 0,
          fileStatuses: prev.fileStatuses?.map((fs, idx) =>
            idx === fileIndex ? { ...fs, status: 'uploading' as const, progress: 0 } : fs
          ),
        }))

        try {
          const result = await uploadSingleFileWithRetry(file, knowledgeBaseId, 0, fileIndex)

          setUploadProgress((prev) => ({
            ...prev,
            filesCompleted: prev.filesCompleted + 1,
            currentFileProgress: 100,
            fileStatuses: prev.fileStatuses?.map((fs, idx) =>
              idx === fileIndex ? { ...fs, status: 'completed' as const, progress: 100 } : fs
            ),
          }))

          return result
        } catch (error) {
          setUploadProgress((prev) => ({
            ...prev,
            fileStatuses: prev.fileStatuses?.map((fs, idx) =>
              idx === fileIndex
                ? {
                    ...fs,
                    status: 'failed' as const,
                    error: getErrorMessage(error),
                  }
                : fs
            ),
          }))
          throw error
        }
      }
    )

    uploadResults.forEach((result, idx) => {
      if (result?.status === 'fulfilled') {
        results.push(result.value)
      } else if (result?.status === 'rejected') {
        failedFiles.push({
          file: files[idx],
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        })
      }
    })

    if (failedFiles.length > 0) {
      throw new KnowledgeUploadError(
        `Failed to upload ${failedFiles.length} file(s)`,
        'PARTIAL_UPLOAD_FAILURE',
        {
          failedFiles,
          uploadedFiles: results,
        }
      )
    }

    return results
  }

  const uploadFiles = async (
    files: File[],
    knowledgeBaseId: string,
    processingOptions: ProcessingOptions
  ): Promise<UploadedFile[]> => {
    if (files.length === 0) {
      throw new KnowledgeUploadError('No files provided for upload', 'NO_FILES')
    }

    if (!knowledgeBaseId?.trim()) {
      throw new KnowledgeUploadError('Knowledge base ID is required', 'INVALID_KB_ID')
    }
    if (!options.workspaceId?.trim()) {
      throw new KnowledgeUploadError('Workspace ID is required', 'INVALID_WORKSPACE_ID')
    }

    try {
      setIsUploading(true)
      setUploadError(null)
      setUploadProgress({ stage: 'uploading', filesCompleted: 0, totalFiles: files.length })

      const uploadedFiles = await uploadFilesWithConcurrency(files, knowledgeBaseId)

      setUploadProgress((prev) => ({ ...prev, stage: 'processing' }))

      const processPayload = {
        documents: uploadedFiles,
        processingOptions: {
          chunkSize: processingOptions.chunkSize,
          minCharactersPerChunk: processingOptions.minCharactersPerChunk,
          chunkOverlap: processingOptions.chunkOverlap,
        },
        bulk: true,
      }

      const processResponse = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(processPayload),
      })

      if (!processResponse.ok) {
        let errorData: any = null
        try {
          errorData = await processResponse.json()
        } catch {
          // Response was not JSON.
        }

        logger.error('Document processing failed:', {
          status: processResponse.status,
          error: errorData,
          uploadedFiles: uploadedFiles.map((file) => ({
            filename: file.filename,
            fileUrl: file.fileUrl,
            fileSize: file.fileSize,
            mimeType: file.mimeType,
          })),
        })

        throw new ProcessingError(
          `Failed to start document processing: ${errorData?.error || errorData?.message || 'Unknown error'}`,
          errorData
        )
      }

      const processResult = await processResponse.json()

      if (!processResult.success) {
        throw new ProcessingError(
          `Document processing failed: ${processResult.error || 'Unknown error'}`,
          processResult
        )
      }

      if (!processResult.data || !processResult.data.documentsCreated) {
        throw new ProcessingError(
          'Invalid processing response: missing document data',
          processResult
        )
      }

      setUploadProgress((prev) => ({ ...prev, stage: 'completing' }))

      logger.info(`Successfully started processing ${uploadedFiles.length} documents`)

      options.onUploadComplete?.(uploadedFiles)

      return uploadedFiles
    } catch (err) {
      logger.error('Error uploading documents:', err)

      const error = createErrorFromException(err, 'Unknown error occurred during upload')
      setUploadError(error)
      options.onError?.(error)

      console.error('Document upload failed:', error.message)

      throw err
    } finally {
      setIsUploading(false)
      setUploadProgress({ stage: 'idle', filesCompleted: 0, totalFiles: 0 })
    }
  }

  const clearError = () => {
    setUploadError(null)
  }

  return {
    isUploading,
    uploadProgress,
    uploadError,
    uploadFiles,
    clearError,
  }
}
