'use client'

import { type DragEvent, useEffect, useRef, useState } from 'react'
import { assertCopilotAttachmentSize } from '@/lib/copilot/native/request-size'
import { createLogger } from '@/lib/logs/console/logger'
import type { CopilotDraft } from '@/stores/copilot/types'
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

export function useUserInputAttachments({
  userId,
  draft,
}: {
  userId?: string
  draft: CopilotDraft
}) {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const attachedFilesRef = useRef<AttachedFile[]>([])
  const draftRef = useRef(draft)
  const dragDepthRef = useRef(0)
  draftRef.current = draft

  const updateFiles = (update: (current: AttachedFile[]) => AttachedFile[]) => {
    attachedFilesRef.current = update(attachedFilesRef.current)
    setAttachedFiles(attachedFilesRef.current)
  }

  useEffect(() => {
    return () => {
      revokePreviewUrls(attachedFilesRef.current)
      attachedFilesRef.current = []
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
      let fileId: string | undefined
      try {
        if (!file.size) throw new Error('Image size is invalid')
        assertCopilotAttachmentSize(draftRef.current, [...attachedFilesRef.current, file])
        const tempFile: AttachedFile = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          uploading: true,
          previewUrl: URL.createObjectURL(file),
        }
        fileId = tempFile.id
        updateFiles((current) => [...current, tempFile])
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result)
              : reject(new Error('Image could not be read'))
          reader.onerror = () => reject(new Error('Image could not be read'))
          reader.readAsDataURL(file)
        })

        if (!attachedFilesRef.current.some((attachedFile) => attachedFile.id === fileId)) continue
        const readyFiles = attachedFilesRef.current.map((attachedFile) =>
          attachedFile.id === fileId ? { ...attachedFile, data, uploading: false } : attachedFile
        )
        assertCopilotAttachmentSize(draftRef.current, readyFiles)
        updateFiles(() => readyFiles)
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'Image upload failed')
        logger.error(`File upload failed: ${error}`)
        if (fileId) {
          updateFiles((current) => {
            revokePreviewUrl(current.find((attachedFile) => attachedFile.id === fileId))
            return current.filter((attachedFile) => attachedFile.id !== fileId)
          })
        }
      }
    }
  }

  const clearAttachedFiles = (submittedIds: string[]) => {
    const submitted = new Set(submittedIds)
    updateFiles((current) => {
      const removed = current.filter((file) => submitted.has(file.id))
      revokePreviewUrls(removed)
      return current.filter((file) => !submitted.has(file.id))
    })
  }

  const removeFile = (fileId: string) => {
    updateFiles((prev) => {
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
