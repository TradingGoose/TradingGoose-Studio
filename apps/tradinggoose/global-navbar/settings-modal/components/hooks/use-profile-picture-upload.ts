import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { uploadImage, validateImageUpload } from '@/lib/uploads/client/image-upload'

const logger = createLogger('ProfilePictureUpload')

interface ProfilePictureUploadMessages {
  fileTooLarge: (fileName: string) => string
  unsupportedFormat: (fileName: string) => string
  uploadFailed: string
}

interface UseProfilePictureUploadProps {
  messages: ProfilePictureUploadMessages
  onUpload: (url: string) => Promise<void>
  onError: (error: string) => void
  currentImage: string | null
}

export function useProfilePictureUpload({
  messages,
  onUpload,
  onError,
  currentImage,
}: UseProfilePictureUploadProps) {
  const previewRef = useRef<string | null>(null)
  const currentImageRef = useRef(currentImage)
  const activeRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImage)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    currentImageRef.current = currentImage
    if (previewRef.current && previewRef.current !== currentImage) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(currentImage)
  }, [currentImage])

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        const validationError = validateImageUpload(file)
        if (validationError) {
          onError(messages[validationError](file.name))
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
          const serverUrl = await uploadImage(file, 'profile-pictures').catch((error) => {
            logger.error('Failed to upload profile picture', error)
            throw new Error(messages.uploadFailed)
          })
          if (!activeRef.current) return

          URL.revokeObjectURL(newPreviewUrl)
          previewRef.current = null
          setPreviewUrl(serverUrl)

          await onUpload(serverUrl)
        } catch (error) {
          if (!activeRef.current) return
          const errorMessage = error instanceof Error ? error.message : messages.uploadFailed
          onError(errorMessage)

          URL.revokeObjectURL(newPreviewUrl)
          previewRef.current = null
          setPreviewUrl(currentImageRef.current)
        } finally {
          if (activeRef.current) setIsUploading(false)
        }
      }
    },
    [onUpload, onError, messages]
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
