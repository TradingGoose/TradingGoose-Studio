'use client'

import { type DragEvent, useEffect, useRef, useState } from 'react'
import { upload as uploadToVercelBlob } from '@vercel/blob/client'
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
  const [isDragging, setIsDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)
  const attachedFilesRef = useRef<AttachedFile[]>([])

  useEffect(() => {
    attachedFilesRef.current = attachedFiles
  }, [attachedFiles])

  useEffect(() => {
    return () => {
      revokePreviewUrls(attachedFilesRef.current)
    }
  }, [])

  const processFiles = async (fileList: FileList) => {
    if (!userId) {
      logger.error('User ID not available for file upload')
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
        const presignedResponse = await fetch('/api/files/presigned?type=copilot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            fileSize: file.size,
            userId,
          }),
        })

        if (!presignedResponse.ok) {
          throw new Error('Failed to get presigned URL')
        }

        const presignedData = await presignedResponse.json()
        let uploadedFilePath = presignedData.fileInfo?.path || ''
        let uploadedFileKey = presignedData.fileInfo?.key || ''

        if (presignedData.storageProvider === 'vercel') {
          await uploadToVercelBlob(presignedData.fileInfo.key, file, {
            access: presignedData.blobAccess || 'private',
            handleUploadUrl: '/api/files/vercel/client-upload?type=copilot',
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
        } else if (presignedData.directUploadSupported !== false) {
          logger.info(`Uploading file: ${presignedData.presignedUrl}`)
          const uploadResponse = await fetch(presignedData.presignedUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type,
              ...(presignedData.uploadHeaders || {}),
            },
            body: file,
          })

          logger.info(`Upload response status: ${uploadResponse.status}`)

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text()
            logger.error(`Upload failed: ${errorText}`)
            throw new Error(`Failed to upload file: ${uploadResponse.status} ${errorText}`)
          }
        } else {
          const formData = new FormData()
          formData.append('file', file)

          const uploadResponse = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData,
          })

          if (!uploadResponse.ok) {
            const errorData = await uploadResponse
              .json()
              .catch(() => ({ error: uploadResponse.statusText }))
            throw new Error(errorData.error || `Failed to upload file: ${uploadResponse.status}`)
          }

          const uploadData = await uploadResponse.json()
          uploadedFilePath = uploadData.path || ''
          uploadedFileKey = uploadData.key || ''
        }

        setAttachedFiles((prev) =>
          prev.map((attachedFile) =>
            attachedFile.id === tempFile.id
              ? {
                  ...attachedFile,
                  path: uploadedFilePath,
                  key: uploadedFileKey,
                  uploading: false,
                }
              : attachedFile
          )
        )
      } catch (error) {
        logger.error(`File upload failed: ${error}`)
        revokePreviewUrl(tempFile)
        setAttachedFiles((prev) => prev.filter((attachedFile) => attachedFile.id !== tempFile.id))
      }
    }
  }

  const clearAttachedFiles = () => {
    revokePreviewUrls(attachedFilesRef.current)
    setAttachedFiles([])
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

    setDragCounter((prev) => {
      const nextCount = prev + 1

      if (nextCount === 1) {
        setIsDragging(true)
      }

      return nextCount
    })
  }

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()

    setDragCounter((prev) => {
      const nextCount = Math.max(0, prev - 1)

      if (nextCount === 0) {
        setIsDragging(false)
      }

      return nextCount
    })
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    setDragCounter(0)

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
  }
}
