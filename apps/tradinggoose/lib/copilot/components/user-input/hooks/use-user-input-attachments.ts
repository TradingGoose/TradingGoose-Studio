'use client'

import { type DragEvent, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
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
        path: '',
        uploading: true,
        previewUrl,
      }

      setAttachedFiles((prev) => [...prev, tempFile])

      try {
        const formData = new FormData()
        formData.append('file', file)
        const response = await fetch('/api/files/upload?type=copilot', {
          method: 'POST',
          body: formData,
        })
        const uploaded = await response.json()
        if (!response.ok) throw new Error(uploaded.error || 'Image upload failed')
        if (
          typeof uploaded.key !== 'string' ||
          !uploaded.key ||
          typeof uploaded.sourceProof !== 'string' ||
          !uploaded.sourceProof
        )
          throw new Error('Image upload ownership could not be verified')
        const uploadedFileKey = uploaded.key
        const uploadedFilePath = uploaded.path || ''

        setAttachedFiles((prev) =>
          prev.map((attachedFile) =>
            attachedFile.id === tempFile.id
              ? {
                  ...attachedFile,
                  path: uploadedFilePath,
                  key: uploadedFileKey,
                  sourceProof: uploaded.sourceProof,
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
