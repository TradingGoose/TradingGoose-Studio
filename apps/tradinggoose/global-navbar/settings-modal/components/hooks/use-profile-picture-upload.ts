import { useCallback, useEffect, useRef, useState } from 'react'
import { upload as uploadToVercelBlob } from '@vercel/blob/client'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ProfilePictureUpload')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

interface ProfilePictureUploadMessages {
  fileTooLarge: (fileName: string) => string
  unsupportedFormat: (fileName: string) => string
  uploadFailed: string
}

interface UseProfilePictureUploadProps {
  messages: ProfilePictureUploadMessages
  onUpload?: (url: string | null) => void | Promise<void>
  onError?: (error: string) => void
  currentImage?: string | null
}

export function useProfilePictureUpload({
  messages,
  onUpload,
  onError,
  currentImage,
}: UseProfilePictureUploadProps) {
  const previewRef = useRef<string | null>(null)
  const activeRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImage || null)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    if (previewRef.current && previewRef.current !== currentImage) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(currentImage || null)
  }, [currentImage])

  const validateFile = useCallback(
    (file: File): string | null => {
      if (file.size > MAX_FILE_SIZE) {
        return messages.fileTooLarge(file.name)
      }
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        return messages.unsupportedFormat(file.name)
      }
      return null
    },
    [messages]
  )

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const uploadFileToServer = useCallback(
    async (file: File): Promise<string> => {
      try {
        const presignedResponse = await fetch('/api/files/presigned?type=profile-pictures', {
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

        if (presignedResponse.ok) {
          const presignedData = await presignedResponse.json()

          logger.info('Presigned URL response:', presignedData)

          if (presignedData.storageProvider === 'vercel') {
            await uploadToVercelBlob(presignedData.fileInfo.key, file, {
              access: presignedData.blobAccess,
              handleUploadUrl: '/api/files/vercel/client-upload?type=profile-pictures',
              clientPayload: JSON.stringify({
                clientUploadAuthorization: presignedData.clientUploadAuthorization,
                contentType: file.type,
                fileName: file.name,
                fileSize: file.size,
                pathname: presignedData.fileInfo.key,
              }),
              contentType: file.type,
            })

            const publicUrl = presignedData.fileInfo.path
            logger.info(
              `Profile picture uploaded successfully via Vercel client upload: ${publicUrl}`
            )
            return publicUrl
          }

          if (presignedData.directUploadSupported && presignedData.presignedUrl) {
            const uploadHeaders: Record<string, string> = {
              'Content-Type': file.type,
            }

            if (presignedData.uploadHeaders) {
              Object.assign(uploadHeaders, presignedData.uploadHeaders)
            }

            const uploadResponse = await fetch(presignedData.presignedUrl, {
              method: 'PUT',
              body: file,
              headers: uploadHeaders,
            })

            logger.info(`Upload response status: ${uploadResponse.status}`)

            if (!uploadResponse.ok) {
              const responseText = await uploadResponse.text()
              logger.error(`Direct upload failed: ${uploadResponse.status} - ${responseText}`)
              throw new Error(`Direct upload failed: ${uploadResponse.status} - ${responseText}`)
            }

            const publicUrl = presignedData.fileInfo.path
            logger.info(`Profile picture uploaded successfully via direct upload: ${publicUrl}`)
            return publicUrl
          }
        }

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
        const publicUrl = data.path
        logger.info(`Profile picture uploaded successfully via server upload: ${publicUrl}`)
        return publicUrl
      } catch (error) {
        logger.error('Failed to upload profile picture', error)
        throw new Error(messages.uploadFailed)
      }
    },
    [messages.uploadFailed]
  )

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        const validationError = validateFile(file)
        if (validationError) {
          onError?.(validationError)
          return
        }

        const newPreviewUrl = URL.createObjectURL(file)

        if (previewRef.current) {
          URL.revokeObjectURL(previewRef.current)
        }

        setPreviewUrl(newPreviewUrl)
        previewRef.current = newPreviewUrl

        setIsUploading(true)
        try {
          const serverUrl = await uploadFileToServer(file)
          if (!activeRef.current) return

          URL.revokeObjectURL(newPreviewUrl)
          previewRef.current = null
          setPreviewUrl(serverUrl)

          await onUpload?.(serverUrl)
        } catch (error) {
          if (!activeRef.current) return
          const errorMessage = error instanceof Error ? error.message : messages.uploadFailed
          onError?.(errorMessage)

          URL.revokeObjectURL(newPreviewUrl)
          previewRef.current = null
          setPreviewUrl(currentImage || null)
        } finally {
          if (activeRef.current) setIsUploading(false)
        }
      }
    },
    [onUpload, onError, uploadFileToServer, validateFile, currentImage]
  )

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current)
      }
    }
  }, [])

  return {
    previewUrl,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    isUploading,
  }
}
