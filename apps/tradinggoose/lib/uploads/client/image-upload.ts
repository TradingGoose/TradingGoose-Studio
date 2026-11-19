import { upload as uploadToVercelBlob } from '@vercel/blob/client'

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024
export const IMAGE_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

export function validateImageUpload(file: File) {
  if (file.size > MAX_IMAGE_FILE_SIZE) return 'fileTooLarge'
  if (!IMAGE_UPLOAD_MIME_TYPES.includes(file.type)) return 'unsupportedFormat'
  return null
}

export async function uploadImage(
  file: File,
  context: 'chat' | 'profile-pictures'
): Promise<string> {
  const metadata = { contentType: file.type, fileName: file.name, fileSize: file.size }
  const presignedResponse = await fetch(`/api/files/presigned?type=${context}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })

  if (presignedResponse.ok) {
    const {
      storageProvider,
      fileInfo,
      blobAccess,
      clientUploadAuthorization,
      directUploadSupported,
      presignedUrl,
      uploadHeaders,
    } = await presignedResponse.json()

    if (storageProvider === 'vercel') {
      await uploadToVercelBlob(fileInfo.key, file, {
        access: blobAccess,
        handleUploadUrl: `/api/files/vercel/client-upload?type=${context}`,
        clientPayload: JSON.stringify({
          clientUploadAuthorization,
          ...metadata,
          pathname: fileInfo.key,
        }),
        contentType: file.type,
      })
      return fileInfo.path
    }

    if (directUploadSupported) {
      const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type, ...uploadHeaders },
      })
      if (!response.ok) {
        throw new Error(`Direct upload failed: ${response.status} - ${await response.text()}`)
      }
      return fileInfo.path
    }
  }

  const body = new FormData()
  body.append('file', file)
  const response = await fetch(`/api/files/upload?type=${context}`, { method: 'POST', body })
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(data.error || `Failed to upload file: ${response.status}`)
  }
  const data = await response.json()
  return data.path
}
