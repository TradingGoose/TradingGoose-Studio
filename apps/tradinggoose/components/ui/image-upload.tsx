'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { upload as uploadToVercelBlob } from '@vercel/blob/client'
import { ImagePlus, Loader2, Trash2, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'

const logger = createLogger('ImageUpload')
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

interface ImageUploadProps {
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
  onUploadStart?: (isUploading: boolean) => void
  title?: string
  description?: string
  height?: string
  className?: string
  disabled?: boolean
  acceptedFormats?: string[]
  uploadToServer?: boolean
  value?: string | null
  hideHeader?: boolean
}

interface UseImageUploadProps {
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
  uploadToServer?: boolean
}

function useImageUpload({
  onUpload,
  onError,
  uploadToServer = false,
}: UseImageUploadProps = {}) {
  const previewRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" is too large. Maximum size is 5MB.`
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      return `File "${file.name}" is not a supported image format. Please use PNG or JPEG.`
    }
    return null
  }, [])

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const uploadThroughServer = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch('/api/files/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(errorData.error || `Failed to upload file: ${response.status}`)
    }

    const data = await response.json()
    logger.info(`Image uploaded successfully via server upload: ${data.path}`)
    return data.path
  }, [])

  const uploadFileToServer = useCallback(
    async (file: File): Promise<string> => {
      try {
        const presignedResponse = await fetch('/api/files/presigned?type=chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            fileSize: file.size,
          }),
        })

        if (!presignedResponse.ok) {
          return uploadThroughServer(file)
        }

        const presignedData = await presignedResponse.json()
        logger.info('Presigned URL response:', presignedData)

        if (presignedData.storageProvider === 'vercel') {
          await uploadToVercelBlob(presignedData.fileInfo.key, file, {
            access: presignedData.blobAccess || 'private',
            handleUploadUrl: '/api/files/vercel/client-upload?type=chat',
            clientPayload: JSON.stringify({
              clientUploadAuthorization: presignedData.clientUploadAuthorization,
              contentType: file.type,
              fileName: file.name,
              fileSize: file.size,
              pathname: presignedData.fileInfo.key,
            }),
            contentType: file.type,
            multipart: file.size > 8 * 1024 * 1024,
          })
          logger.info(
            `Image uploaded successfully via Vercel client upload: ${presignedData.fileInfo.path}`
          )
          return presignedData.fileInfo.path
        }

        if (presignedData.directUploadSupported !== false) {
          const uploadHeaders: Record<string, string> = {
            'Content-Type': file.type,
          }

          if (presignedData.uploadHeaders) {
            Object.assign(uploadHeaders, presignedData.uploadHeaders)
          }

          const uploadTarget = presignedData.uploadUrl || presignedData.presignedUrl
          const uploadResponse = await fetch(uploadTarget, {
            method: 'PUT',
            body: file,
            headers: uploadHeaders,
          })

          logger.info(`Upload response status: ${uploadResponse.status}`)
          logger.info(
            'Upload response headers:',
            Object.fromEntries(uploadResponse.headers.entries())
          )

          if (!uploadResponse.ok) {
            const responseText = await uploadResponse.text()
            logger.error(`Direct upload failed: ${uploadResponse.status} - ${responseText}`)
            throw new Error(`Direct upload failed: ${uploadResponse.status} - ${responseText}`)
          }

          logger.info(`Image uploaded successfully via direct upload: ${presignedData.fileInfo.path}`)
          return presignedData.fileInfo.path
        }

        return uploadThroughServer(file)
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Failed to upload image')
      }
    },
    [uploadThroughServer]
  )

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      const validationError = validateFile(file)
      if (validationError) {
        onError?.(validationError)
        return
      }

      setFileName(file.name)

      const previewUrl = URL.createObjectURL(file)
      setPreviewUrl(previewUrl)
      previewRef.current = previewUrl

      if (!uploadToServer) {
        onUpload?.(previewUrl)
        return
      }

      setIsUploading(true)
      try {
        const serverUrl = await uploadFileToServer(file)
        onUpload?.(serverUrl)
      } catch (error) {
        onError?.(error instanceof Error ? error.message : 'Failed to upload image')
      } finally {
        setIsUploading(false)
      }
    },
    [onUpload, onError, uploadToServer, uploadFileToServer, validateFile]
  )

  const handleRemove = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl(null)
    setFileName(null)
    previewRef.current = null
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onUpload?.(null)
  }, [previewUrl, onUpload])

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current)
      }
    }
  }, [])

  return {
    previewUrl,
    fileName,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleRemove,
    isUploading,
  }
}

export function ImageUpload({
  onUpload,
  onError,
  onUploadStart,
  title = 'Logo Image',
  description = 'PNG or JPEG (max 5MB)',
  height = 'h-64',
  className,
  disabled = false,
  acceptedFormats = ['image/png', 'image/jpeg', 'image/jpg'],
  uploadToServer = false,
  value,
  hideHeader = false,
}: ImageUploadProps) {
  const {
    previewUrl,
    fileName,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleRemove,
    isUploading,
  } = useImageUpload({
    onUpload,
    onError,
    uploadToServer,
  })

  const [isDragging, setIsDragging] = useState(false)

  // Use value prop if provided, otherwise use internal previewUrl
  const displayUrl = value || previewUrl
  const isDisabled = disabled || isUploading

  // Notify parent when upload status changes
  useEffect(() => {
    onUploadStart?.(isUploading)
  }, [isUploading, onUploadStart])

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (isDisabled) return

      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const file = e.dataTransfer.files?.[0]
      if (file) {
        const fakeEvent = {
          target: {
            files: [file],
          },
        } as unknown as React.ChangeEvent<HTMLInputElement>
        handleFileChange(fakeEvent)
      }
    },
    [isDisabled, handleFileChange]
  )

  return (
    <div
      className={cn(
        hideHeader
          ? 'w-full space-y-4'
          : 'w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm',
        className
      )}
    >
      {!hideHeader && (
        <div className='space-y-2'>
          <h3 className='font-medium text-lg'>{title}</h3>
          <p className='text-muted-foreground text-sm'>{description}</p>
        </div>
      )}

      <Input
        type='file'
        accept={acceptedFormats.join(',')}
        className='hidden'
        ref={fileInputRef}
        onChange={handleFileChange}
        disabled={isDisabled}
      />

      {!displayUrl ? (
        <div
          onClick={
            isDisabled
              ? undefined
              : (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleThumbnailClick()
                }
          }
          onDragOver={isDisabled ? undefined : handleDragOver}
          onDragEnter={isDisabled ? undefined : handleDragEnter}
          onDragLeave={isDisabled ? undefined : handleDragLeave}
          onDrop={isDisabled ? undefined : handleDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-muted-foreground/25 border-dashed bg-muted/50 transition-colors',
            height,
            !isDisabled && 'hover:bg-muted',
            isDragging && !isDisabled && 'border-primary/50 bg-primary/5',
            isDisabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <div className='rounded-full bg-background p-3 shadow-sm'>
            {isUploading ? (
              <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
            ) : (
              <ImagePlus className='h-6 w-6 text-muted-foreground' />
            )}
          </div>
          <div className='text-center'>
            <p className='font-medium text-sm'>
              {isUploading ? 'Uploading...' : 'Click to select'}
            </p>
            <p className='text-muted-foreground text-xs'>
              {isUploading ? 'Please wait' : 'or drag and drop file here'}
            </p>
          </div>
        </div>
      ) : displayUrl ? (
        <div className='relative'>
          <div className={cn('group relative overflow-hidden rounded-lg border', height)}>
            <Image
              src={displayUrl}
              alt='Preview'
              fill
              className='object-cover transition-transform duration-300 group-hover:scale-105'
              sizes='(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
            />
            <div className='absolute inset-0 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100' />
            <div className='absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity group-hover:opacity-100'>
              <Button
                type='button'
                size='sm'
                variant='secondary'
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleThumbnailClick()
                }}
                className='h-9 w-9 p-0'
                disabled={isDisabled}
              >
                <Upload className='h-4 w-4' />
              </Button>
              <Button
                type='button'
                size='sm'
                variant='destructive'
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleRemove()
                }}
                className='h-9 w-9 p-0'
                disabled={isDisabled}
              >
                <Trash2 className='h-4 w-4' />
              </Button>
            </div>
          </div>
          {fileName && (
            <div className='mt-2 flex items-center gap-2 text-muted-foreground text-sm'>
              <span className='truncate'>{fileName}</span>
              <button
                type='button'
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleRemove()
                }}
                className='ml-auto rounded-full p-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                disabled={isDisabled}
              >
                <X className='h-4 w-4' />
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
