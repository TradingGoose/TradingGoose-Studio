'use client'

import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui'
import type { AttachedFile } from '../types'

interface AttachedFilesGridProps {
  attachedFiles: AttachedFile[]
  onFileClick: (file: AttachedFile) => void
  onRemoveFile: (fileId: string) => void
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) {
    return '0 Bytes'
  }

  const kilobyte = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const sizeIndex = Math.floor(Math.log(bytes) / Math.log(kilobyte))
  return `${Math.round((bytes / kilobyte ** sizeIndex) * 100) / 100} ${sizes[sizeIndex]}`
}

const isImageFile = (type: string) => type.startsWith('image/')

const getFileIcon = (mediaType: string) => {
  if (mediaType.startsWith('image/')) {
    return <ImageIcon className='h-5 w-5 text-muted-foreground' />
  }

  if (mediaType.includes('pdf')) {
    return <FileText className='h-5 w-5 text-red-500' />
  }

  if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
    return <FileText className='h-5 w-5 text-blue-500' />
  }

  return <FileText className='h-5 w-5 text-muted-foreground' />
}

export function AttachedFilesGrid({
  attachedFiles,
  onFileClick,
  onRemoveFile,
}: AttachedFilesGridProps) {
  if (attachedFiles.length === 0) {
    return null
  }

  return (
    <div className='mb-2 flex flex-wrap gap-1.5'>
      {attachedFiles.map((file) => (
        <div
          key={file.id}
          className='group relative h-16 w-16 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-card/40'
          title={`${file.name} (${formatFileSize(file.size)})`}
          onClick={() => onFileClick(file)}
        >
          {isImageFile(file.type) && file.previewUrl ? (
            <img src={file.previewUrl} alt={file.name} className='h-full w-full object-cover' />
          ) : isImageFile(file.type) && file.key ? (
            <img
              src={file.previewUrl || file.path}
              alt={file.name}
              className='h-full w-full object-cover'
            />
          ) : (
            <div className='flex h-full w-full items-center justify-center bg-background/50'>
              {getFileIcon(file.type)}
            </div>
          )}

          {file.uploading && (
            <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
              <Loader2 className='h-4 w-4 animate-spin text-white' />
            </div>
          )}

          {!file.uploading && (
            <Button
              variant='ghost'
              size='icon'
              onClick={(event) => {
                event.stopPropagation()
                onRemoveFile(file.id)
              }}
              className='absolute top-0.5 right-0.5 h-5 w-5 bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100'
            >
              <X className='h-3 w-3' />
            </Button>
          )}

          <div className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
        </div>
      ))}
    </div>
  )
}
