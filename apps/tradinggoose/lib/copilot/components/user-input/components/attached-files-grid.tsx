'use client'

import { FileText, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui'
import { formatFileSize } from '@/i18n/formatters'
import type { AttachedFile } from '../types'

interface AttachedFilesGridProps {
  attachedFiles: AttachedFile[]
  onFileClick: (file: AttachedFile) => void
  onRemoveFile: (fileId: string) => void
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
  const locale = useLocale()

  if (attachedFiles.length === 0) {
    return null
  }

  return (
    <div className='mb-2 flex flex-wrap gap-1.5'>
      {attachedFiles.map((file) => (
        <div key={file.id} className='group relative h-16 w-16'>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type='button'
                  className='relative h-full w-full cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-card/40'
                  aria-label={`Open ${file.name}`}
                  onClick={() => onFileClick(file)}
                >
                  {isImageFile(file.type) && file.previewUrl ? (
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      className='h-full w-full object-cover'
                    />
                  ) : isImageFile(file.type) && file.key ? (
                    <img
                      src={file.previewUrl || file.path}
                      alt={file.name}
                      className='h-full w-full object-cover'
                    />
                  ) : (
                    <span className='flex h-full w-full items-center justify-center bg-background/50'>
                      {getFileIcon(file.type)}
                    </span>
                  )}

                  {file.uploading && (
                    <span className='absolute inset-0 flex items-center justify-center bg-black/50'>
                      <Loader2 className='h-4 w-4 animate-spin text-white' />
                    </span>
                  )}

                  <span className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
                </button>
              }
            />
            <TooltipContent side='top'>{`${file.name} (${formatFileSize(locale, file.size)})`}</TooltipContent>
          </Tooltip>

          {!file.uploading && (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={`Remove ${file.name}`}
              onClick={() => onRemoveFile(file.id)}
              className='absolute top-0.5 right-0.5 z-10 h-5 w-5 bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100'
            >
              <X className='h-3 w-3' />
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
