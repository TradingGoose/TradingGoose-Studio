import { memo, useState } from 'react'
import { FileText, Image } from 'lucide-react'
import type { MessageFileAttachment } from '../../user-input/user-input'

interface FileAttachmentDisplayProps {
  fileAttachments: MessageFileAttachment[]
}

export const FileAttachmentDisplay = memo(({ fileAttachments }: FileAttachmentDisplayProps) => {
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set())

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
  }

  const getFileIcon = (mediaType: string) => {
    if (mediaType.startsWith('image/')) {
      return <Image className='h-5 w-5 text-muted-foreground' />
    }
    if (mediaType.includes('pdf')) {
      return <FileText className='h-5 w-5 text-red-500' />
    }
    if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
      return <FileText className='h-5 w-5 text-blue-500' />
    }
    return <FileText className='h-5 w-5 text-muted-foreground' />
  }

  const getFileUrl = (file: MessageFileAttachment) => {
    return `/api/files/serve/${encodeURIComponent(file.key)}?context=copilot`
  }

  const handleFileClick = (file: MessageFileAttachment) => {
    const serveUrl = getFileUrl(file)
    window.open(serveUrl, '_blank')
  }

  const isImageFile = (mediaType: string) => {
    return mediaType.startsWith('image/')
  }

  return (
    <>
      {fileAttachments.map((file) => (
        <div
          key={file.id}
          className='group relative h-16 w-16 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-card/40'
          onClick={() => handleFileClick(file)}
          title={`${file.filename} (${formatFileSize(file.size)})`}
        >
          {isImageFile(file.media_type) && !failedImageIds.has(file.id) ? (
            // For images, show actual thumbnail
            <img
              src={getFileUrl(file)}
              alt={file.filename}
              className='h-full w-full object-cover'
              onError={() => {
                setFailedImageIds((current) => {
                  if (current.has(file.id)) return current
                  const next = new Set(current)
                  next.add(file.id)
                  return next
                })
              }}
            />
          ) : (
            // For other files, show icon centered
            <div className='flex h-full w-full items-center justify-center bg-background/50'>
              {getFileIcon(file.media_type)}
            </div>
          )}

          {/* Hover overlay effect */}
          <div className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
        </div>
      ))}
    </>
  )
})

FileAttachmentDisplay.displayName = 'FileAttachmentDisplay'
