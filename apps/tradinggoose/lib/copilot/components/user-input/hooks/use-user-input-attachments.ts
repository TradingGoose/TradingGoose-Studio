'use client'

import { type DragEvent, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { AttachedFile } from '../types'

const logger = createLogger('CopilotUserInputAttachments')

const revokePreviewUrl = (file?: AttachedFile) => {
  if (file?.previewUrl) {
    URL.revokeObjectURL(file.previewUrl)
  }
}

const revokePreviewUrls = (files: AttachedFile[]) => {
  files.forEach((file) => revokePreviewUrl(file))
}

export function useUserInputAttachments({ userId }: { userId?: string }) {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const attachedFilesRef = useRef<AttachedFile[]>([])
  const dragDepthRef = useRef(0)

  useEffect(() => {
    attachedFilesRef.current = attachedFiles
  }, [attachedFiles])

  useEffect(() => {
    return () => {
      revokePreviewUrls(attachedFilesRef.current)
    }
  }, [])

  const processFiles = async (fileList: FileList) => {
    setUploadError(null)
    if (!userId) {
      setUploadError('Sign in to upload images')
      logger.error('User ID not available for file upload')
      return
    }
    if (Array.from(fileList).some((file) => !file.type.startsWith('image/'))) {
      setUploadError('Only image files can be attached')
      return
    }

    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith('image/')) {
        logger.warn(`File ${file.name} is not an image. Only image files are allowed.`)
        continue
      }

      const previewUrl = URL.createObjectURL(file)
      const tempFile: AttachedFile = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        uploading: true,
        previewUrl,
      }

      setAttachedFiles((prev) => [...prev, tempFile])

      try {
        if (!file.size || file.size > MAX_FILE_SIZE) throw new Error('Image size is invalid')
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result)
              : reject(new Error('Image could not be read'))
          reader.onerror = () => reject(new Error('Image could not be read'))
          reader.readAsDataURL(file)
        })

        setAttachedFiles((prev) =>
          prev.map((attachedFile) =>
            attachedFile.id === tempFile.id
              ? {
                  ...attachedFile,
                  data,
                  uploading: false,
                }
              : attachedFile
          )
        )
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'Image upload failed')
        logger.error(`File upload failed: ${error}`)
        revokePreviewUrl(tempFile)
        setAttachedFiles((prev) => prev.filter((attachedFile) => attachedFile.id !== tempFile.id))
      }
    }
  }

  const clearAttachedFiles = (submittedIds: string[]) => {
    const submitted = new Set(submittedIds)
    setAttachedFiles((current) => {
      const removed = current.filter((file) => submitted.has(file.id))
      revokePreviewUrls(removed)
      return current.filter((file) => !submitted.has(file.id))
    })
  }

  const removeFile = (fileId: string) => {
    setAttachedFiles((prev) => {
      const file = prev.find((attachedFile) => attachedFile.id === fileId)
      revokePreviewUrl(file)
      return prev.filter((attachedFile) => attachedFile.id !== fileId)
    })
  }

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    dragDepthRef.current += 1
    if (dragDepthRef.current === 1) setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    setIsDragging(dragDepthRef.current > 0)
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setIsDragging(false)

    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      await processFiles(event.dataTransfer.files)
    }
  }

  return {
    attachedFiles,
    clearAttachedFiles,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isDragging,
    processFiles,
    removeFile,
    uploadError,
  }
}
