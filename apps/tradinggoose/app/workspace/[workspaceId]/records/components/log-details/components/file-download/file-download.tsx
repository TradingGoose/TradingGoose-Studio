'use client'

import { useState } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('FileDownload')

interface FileDownloadProps {
  file: {
    id?: string
    name: string
    size: number
    type: string
    key: string
    url: string
    uploadedAt: string
    expiresAt: string
    storageProvider?: 's3' | 'azure' | 'vercel' | 'local'
    bucketName?: string
  }
  isExecutionFile?: boolean // Flag to indicate this is an execution file
  className?: string
}

export function FileDownload({ file, isExecutionFile = false, className }: FileDownloadProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const handleDownload = async () => {
    if (isDownloading) return

    setIsDownloading(true)
    setDownloadError(null)

    try {
      logger.info(`Initiating download for file: ${file.name}`)

      // Generate a fresh download URL
      const response = await fetch('/api/files/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: file.key,
          name: file.name,
          isExecutionFile, // Add flag to indicate execution file
        }),
      })

      if (!response.ok) {
        const errorData: unknown = await response.json().catch(() => null)
        const detail =
          errorData && typeof errorData === 'object'
            ? 'message' in errorData &&
              typeof errorData.message === 'string' &&
              errorData.message.trim()
              ? errorData.message
              : 'error' in errorData && typeof errorData.error === 'string'
                ? errorData.error
                : null
            : null
        throw new Error(detail || `Download is unavailable (${response.status}).`)
      }

      const { downloadUrl, fileName } = await response.json()

      if (typeof downloadUrl !== 'string' || !downloadUrl.trim()) {
        throw new Error('The authorized download is unavailable.')
      }

      // Open only the newly authorized URL, never the stored output URL.
      window.open(downloadUrl, '_blank')

      logger.info(`Download initiated for file: ${fileName}`)
    } catch (error) {
      logger.error(`Failed to download file ${file.name}:`, error)
      setDownloadError(error instanceof Error ? error.message : 'The file could not be downloaded.')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className='flex max-w-xs flex-col items-end gap-1'>
      <Button
        variant='ghost'
        size='sm'
        className={`h-6 px-2 text-[11px] ${className || ''}`}
        onClick={handleDownload}
        disabled={isDownloading}
      >
        {isDownloading ? (
          <Loader2 className='h-3 w-3 animate-spin' />
        ) : (
          <ArrowDown className='h-3 w-3' />
        )}
        {isDownloading ? 'Downloading...' : 'Download'}
      </Button>
      {downloadError && (
        <p role='alert' className='text-destructive text-xs'>
          {downloadError} Request a new authorized download from the file owner.
        </p>
      )}
    </div>
  )
}
