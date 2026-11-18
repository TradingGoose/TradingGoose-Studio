'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  IMAGE_UPLOAD_MIME_TYPES,
  uploadImage,
  validateImageUpload,
} from '@/lib/uploads/client/image-upload'
import { cn } from '@/lib/utils'

interface ImageUploadProps {
  id: string
  labelledBy: string
  describedBy?: string
  labels: {
    select: string
    drop: string
    uploading: string
    wait: string
    replace: string
    delete: string
    removeFile: string
    previewAlt: string
  }
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
  onUploadStart?: (isUploading: boolean) => void
  height?: string
  className?: string
  disabled?: boolean
  value?: string | null
}

interface UseImageUploadProps {
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
}

function useImageUpload({ onUpload, onError }: UseImageUploadProps = {}) {
  const previewRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      const validationError = validateImageUpload(file)
      if (validationError) {
        onError?.(
          validationError === 'fileTooLarge'
            ? `File "${file.name}" is too large. Maximum size is 5MB.`
            : `File "${file.name}" is not a supported image format. Please use PNG or JPEG.`
        )
        return
      }

      setFileName(file.name)

      const previewUrl = URL.createObjectURL(file)
      setPreviewUrl(previewUrl)
      previewRef.current = previewUrl

      setIsUploading(true)
      try {
        const serverUrl = await uploadImage(file, 'chat')
        onUpload?.(serverUrl)
      } catch (error) {
        onError?.(error instanceof Error ? error.message : 'Failed to upload image')
      } finally {
        setIsUploading(false)
      }
    },
    [onUpload, onError]
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
  id,
  labelledBy,
  describedBy,
  labels,
  onUpload,
  onError,
  onUploadStart,
  height = 'h-64',
  className,
  disabled = false,
  value,
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
  })

  const [isDragging, setIsDragging] = useState(false)

  // Use value prop if provided, otherwise use internal previewUrl
  const displayUrl = value || previewUrl
  const isDisabled = disabled || isUploading

  // Notify parent when upload status changes
  useEffect(() => {
    onUploadStart?.(isUploading)
  }, [isUploading, onUploadStart])

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragEnter = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
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
    <div className={cn('w-full space-y-4', className)}>
      <Input
        id={`${id}-input`}
        type='file'
        accept={IMAGE_UPLOAD_MIME_TYPES.join(',')}
        className='hidden'
        ref={fileInputRef}
        onChange={handleFileChange}
        disabled={isDisabled}
        tabIndex={-1}
        aria-label={labels.select}
      />

      {!displayUrl ? (
        <Button
          id={id}
          type='button'
          variant='ghost'
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-busy={isUploading}
          disabled={isDisabled}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            handleThumbnailClick()
          }}
          onDragOver={isDisabled ? undefined : handleDragOver}
          onDragEnter={isDisabled ? undefined : handleDragEnter}
          onDragLeave={isDisabled ? undefined : handleDragLeave}
          onDrop={isDisabled ? undefined : handleDrop}
          className={cn(
            'flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-muted-foreground/25 border-dashed bg-muted/50 transition-colors',
            height,
            !isDisabled && 'hover:bg-muted',
            isDragging && !isDisabled && 'border-primary/50 bg-primary/5',
            isDisabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <div className='rounded-full bg-background p-3 shadow-sm'>
            {isUploading ? (
              <Loader2 aria-hidden='true' className='h-6 w-6 animate-spin text-muted-foreground' />
            ) : (
              <ImagePlus aria-hidden='true' className='h-6 w-6 text-muted-foreground' />
            )}
          </div>
          <div className='text-center'>
            <p className='font-medium text-sm'>{isUploading ? labels.uploading : labels.select}</p>
            <p className='text-muted-foreground text-xs'>
              {isUploading ? labels.wait : labels.drop}
            </p>
          </div>
        </Button>
      ) : (
        <div className='relative'>
          <div className={cn('group relative overflow-hidden rounded-lg border', height)}>
            <Image
              src={displayUrl}
              alt={labels.previewAlt}
              fill
              className='object-cover transition-transform duration-300 group-focus-within:scale-105 group-hover:scale-105'
              sizes='(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
            />
            <div className='absolute inset-0 bg-black/40 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100' />
            <div className='absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'>
              <Button
                id={id}
                type='button'
                size='sm'
                variant='secondary'
                aria-label={labels.replace}
                aria-describedby={describedBy}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  handleThumbnailClick()
                }}
                onDragOver={isDisabled ? undefined : handleDragOver}
                onDragEnter={isDisabled ? undefined : handleDragEnter}
                onDragLeave={isDisabled ? undefined : handleDragLeave}
                onDrop={isDisabled ? undefined : handleDrop}
                className='h-9 w-9 p-0'
                disabled={isDisabled}
              >
                <Upload aria-hidden='true' className='h-4 w-4' />
              </Button>
              <Button
                type='button'
                size='sm'
                variant='destructive'
                aria-label={labels.delete}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  handleRemove()
                }}
                className='h-9 w-9 p-0'
                disabled={isDisabled}
              >
                <Trash2 aria-hidden='true' className='h-4 w-4' />
              </Button>
            </div>
          </div>
          {fileName && (
            <div className='mt-2 flex items-center gap-2 text-muted-foreground text-sm'>
              <span className='truncate'>{fileName}</span>
              <button
                type='button'
                aria-label={labels.removeFile}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  handleRemove()
                }}
                className='ml-auto rounded-full p-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                disabled={isDisabled}
              >
                <X aria-hidden='true' className='h-4 w-4' />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
