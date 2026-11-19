import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    setPreviewUrl(null)
  }, [currentImage])

  async function upload(file?: File) {
    if (!file || previewRef.current) return
    const validationError = validateImageUpload(file)
    if (validationError) {
      onError(messages[validationError](file.name))
      return
    }

    const objectUrl = URL.createObjectURL(file)
    previewRef.current = objectUrl
    setPreviewUrl(objectUrl)
    setIsUploading(true)
    try {
      const serverUrl = await uploadImage(file, 'profile-pictures').catch((error) => {
        logger.error('Failed to upload profile picture', error)
        throw new Error(messages.uploadFailed)
      })
      if (previewRef.current !== objectUrl) return
      setPreviewUrl(serverUrl)
      await onUpload(serverUrl)
    } catch (error) {
      if (previewRef.current !== objectUrl) return
      onError(error instanceof Error ? error.message : messages.uploadFailed)
      setPreviewUrl(null)
    } finally {
      if (previewRef.current === objectUrl) {
        URL.revokeObjectURL(objectUrl)
        previewRef.current = null
        setIsUploading(false)
      }
    }
  }

  useLayoutEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current)
        previewRef.current = null
      }
    }
  }, [])

  return { previewUrl, upload, isUploading }
}
